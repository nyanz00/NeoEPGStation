import { createHash } from 'crypto';
import { inject, injectable } from 'inversify';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import * as apid from '../../../../api';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IViewerProfileApiModel from '../viewerProfile/IViewerProfileApiModel';
import ITwitterApiModel from './ITwitterApiModel';

interface StoredTwitterCredential {
    cookiesText: string;
    userAgent?: string;
    account: apid.TwitterAccountInfo;
}

interface TwitterBrowserSession {
    fingerprint: string;
    browser: Browser;
    context: BrowserContext;
    page: Page;
    queue: Promise<void>;
    idleTimer: NodeJS.Timeout | null;
    lastPostAt: number;
}

interface ParsedTweet {
    id: string;
    url: string;
    text: string;
    authorName: string;
    authorScreenName: string;
    authorIconUrl?: string;
    createdAt?: number;
    imageUrls: string[];
    replyCount: number;
    retweetCount: number;
    likeCount: number;
    retweeted: boolean;
    liked: boolean;
}

type TwitterCookie = Parameters<BrowserContext['addCookies']>[0][number];

@injectable()
export default class TwitterApiModel implements ITwitterApiModel {
    private static readonly PROVIDER = 'twitter';
    private static readonly IDLE_TIMEOUT = 60_000;
    private static readonly MINIMUM_POST_INTERVAL = 20_000;
    private readonly log: ILogger;
    private readonly sessions = new Map<number, TwitterBrowserSession>();
    private readonly sessionInitializations = new Map<number, Promise<TwitterBrowserSession>>();
    private readonly sessionGenerations = new Map<number, number>();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IViewerProfileApiModel') private viewerProfileApiModel: IViewerProfileApiModel,
    ) {
        this.log = logger.getLogger();
    }

    public async getStatus(viewerProfileId?: apid.ViewerProfileId): Promise<apid.TwitterStatus> {
        if (viewerProfileId === undefined) return { configured: false };
        const credential = await this.readCredential(viewerProfileId);
        return credential === null
            ? { configured: false, viewerProfileId }
            : { configured: true, viewerProfileId, account: credential.account };
    }

    public async connect(
        viewerProfileId: apid.ViewerProfileId,
        cookiesText: string,
        userAgent?: string,
    ): Promise<apid.TwitterStatus> {
        const normalized = cookiesText.trim();
        const cookies = this.parseNetscapeCookies(normalized);
        if (!cookies.some(cookie => cookie.name === 'auth_token') || !cookies.some(cookie => cookie.name === 'ct0')) {
            throw new Error('cookies.txtにXのauth_tokenまたはct0が含まれていません');
        }

        await this.closeSession(viewerProfileId);
        const temporary: StoredTwitterCredential = {
            cookiesText: normalized,
            userAgent: userAgent?.trim() || undefined,
            account: { name: '', screenName: '', iconUrl: undefined },
        };
        const session = await this.createSession(temporary);
        try {
            const account = await this.readLoggedInAccount(session.page);
            const credential: StoredTwitterCredential = { ...temporary, account };
            await this.viewerProfileApiModel.setCredential(
                viewerProfileId,
                TwitterApiModel.PROVIDER,
                JSON.stringify(credential),
            );
            return { configured: true, viewerProfileId, account };
        } finally {
            await session.context.close().catch(() => undefined);
            await session.browser.close().catch(() => undefined);
        }
    }

    public async disconnect(viewerProfileId: apid.ViewerProfileId): Promise<void> {
        await this.closeSession(viewerProfileId);
        await this.viewerProfileApiModel.deleteCredential(viewerProfileId, TwitterApiModel.PROVIDER);
    }

    public async getTimeline(viewerProfileId: apid.ViewerProfileId): Promise<apid.TwitterTimeline> {
        return this.withSession(viewerProfileId, async page => {
            await this.openAuthenticatedPage(page, 'https://x.com/home');
            await this.waitForTweets(page);
            return { tweets: await this.readTweets(page), refreshedAt: Date.now() };
        });
    }

    public async search(viewerProfileId: apid.ViewerProfileId, query: string): Promise<apid.TwitterTimeline> {
        const normalized = query.trim();
        if (normalized.length === 0 || normalized.length > 500) throw new Error('検索キーワードが不正です');
        return this.withSession(viewerProfileId, async page => {
            await this.openAuthenticatedPage(
                page,
                `https://x.com/search?q=${encodeURIComponent(normalized)}&src=typed_query&f=live`,
            );
            await this.waitForTweets(page);
            return { tweets: await this.readTweets(page), refreshedAt: Date.now() };
        });
    }

    public async post(viewerProfileId: apid.ViewerProfileId, text: string): Promise<void> {
        const normalized = text.trim();
        if (normalized.length === 0) throw new Error('投稿内容を入力してください');
        if (Array.from(normalized).length > 280) throw new Error('投稿内容が280文字を超えています');
        const session = await this.getSession(viewerProfileId);
        await this.runExclusive(session, async () => {
            const wait = TwitterApiModel.MINIMUM_POST_INTERVAL - (Date.now() - session.lastPostAt);
            if (wait > 0) throw new Error(`連続投稿を避けるため${Math.ceil(wait / 1000).toString(10)}秒待ってください`);
            await this.openAuthenticatedPage(session.page, 'https://x.com/compose/post');
            const editor = session.page.locator('[data-testid="tweetTextarea_0"]').first();
            await editor.waitFor({ state: 'visible', timeout: 20_000 });
            await editor.fill(normalized);
            const responsePromise = session.page.waitForResponse(response => response.url().includes('CreateTweet'), {
                timeout: 30_000,
            });
            const button = session.page.locator('[data-testid="tweetButton"]').first();
            await button.waitFor({ state: 'visible', timeout: 10_000 });
            await button.click();
            const response = await responsePromise;
            if (!response.ok()) throw new Error(`Xへの投稿に失敗しました (HTTP ${response.status().toString(10)})`);
            session.lastPostAt = Date.now();
            this.touchSession(session);
        });
    }

    private async withSession<T>(
        viewerProfileId: apid.ViewerProfileId,
        operation: (page: Page) => Promise<T>,
    ): Promise<T> {
        const session = await this.getSession(viewerProfileId);
        return this.runExclusive(session, async () => {
            try {
                return await operation(session.page);
            } finally {
                this.touchSession(session);
            }
        });
    }

    private async runExclusive<T>(session: TwitterBrowserSession, operation: () => Promise<T>): Promise<T> {
        const previous = session.queue;
        let release: (() => void) | undefined;
        session.queue = new Promise<void>(resolve => {
            release = resolve;
        });
        await previous;
        try {
            return await operation();
        } finally {
            release?.();
        }
    }

    private async getSession(viewerProfileId: number): Promise<TwitterBrowserSession> {
        const initializing = this.sessionInitializations.get(viewerProfileId);
        if (initializing !== undefined) {
            return initializing;
        }

        const generation = this.sessionGenerations.get(viewerProfileId) ?? 0;
        const promise = this.initializeSession(viewerProfileId, generation);
        this.sessionInitializations.set(viewerProfileId, promise);
        try {
            return await promise;
        } finally {
            if (this.sessionInitializations.get(viewerProfileId) === promise) {
                this.sessionInitializations.delete(viewerProfileId);
            }
        }
    }

    private async initializeSession(viewerProfileId: number, generation: number): Promise<TwitterBrowserSession> {
        const credential = await this.readCredential(viewerProfileId);
        if (credential === null) throw new Error('Twitterアカウントが連携されていません');
        if (generation !== (this.sessionGenerations.get(viewerProfileId) ?? 0)) {
            throw new Error('TwitterSessionInvalidated');
        }
        const fingerprint = this.credentialFingerprint(credential);
        const current = this.sessions.get(viewerProfileId);
        if (current !== undefined && current.fingerprint === fingerprint && current.browser.isConnected()) {
            this.touchSession(current);
            return current;
        }
        await this.closeSession(viewerProfileId);
        const sessionGeneration = this.sessionGenerations.get(viewerProfileId) ?? 0;
        const session = await this.createSession(credential);
        if (sessionGeneration !== (this.sessionGenerations.get(viewerProfileId) ?? 0)) {
            await session.context.close().catch(() => undefined);
            await session.browser.close().catch(() => undefined);
            throw new Error('TwitterSessionInvalidated');
        }
        session.fingerprint = fingerprint;
        this.sessions.set(viewerProfileId, session);
        this.touchSession(session, viewerProfileId);
        return session;
    }

    private async createSession(credential: StoredTwitterCredential): Promise<TwitterBrowserSession> {
        let browser: Browser;
        try {
            browser = await chromium.launch({
                channel: 'chrome',
                headless: true,
                args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
            });
        } catch (error) {
            this.log.system.error('Failed to start Chrome for Twitter integration');
            throw new Error(
                `Twitter連携用のChromeを起動できません: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        try {
            const context = await browser.newContext({
                userAgent: credential.userAgent,
                locale: 'ja-JP',
                timezoneId: 'Asia/Tokyo',
                viewport: { width: 1280, height: 900 },
            });
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            });
            await context.addCookies(this.parseNetscapeCookies(credential.cookiesText));
            const page = await context.newPage();
            page.setDefaultTimeout(20_000);
            return {
                fingerprint: this.credentialFingerprint(credential),
                browser,
                context,
                page,
                queue: Promise.resolve(),
                idleTimer: null,
                lastPostAt: 0,
            };
        } catch (error) {
            await browser.close().catch(() => undefined);
            throw error;
        }
    }

    private async openAuthenticatedPage(page: Page, url: string): Promise<void> {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(1_500);
        if (/\/i\/flow\/login|\/login(?:\?|$)/.test(page.url())) {
            throw new Error('TwitterのログインCookieが無効です。設定から再連携してください');
        }
        const profileLink = page.locator('a[data-testid="AppTabBar_Profile_Link"]').first();
        try {
            await profileLink.waitFor({ state: 'attached', timeout: 15_000 });
        } catch {
            throw new Error('Twitterへログインできませんでした。Cookieの期限やアカウント状態を確認してください');
        }
    }

    private async readLoggedInAccount(page: Page): Promise<apid.TwitterAccountInfo> {
        await this.openAuthenticatedPage(page, 'https://x.com/home');
        const href = await page.locator('a[data-testid="AppTabBar_Profile_Link"]').first().getAttribute('href');
        const screenName = href?.match(/^\/([^/?#]+)$/)?.[1];
        if (screenName === undefined || screenName.length === 0)
            throw new Error('Twitterアカウント名を取得できませんでした');
        const switcher = page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').first();
        const text = (await switcher.textContent().catch(() => null)) ?? '';
        const name = text.split(`@${screenName}`)[0]?.trim() || screenName;
        const iconUrl =
            (await switcher
                .locator('img')
                .first()
                .getAttribute('src')
                .catch(() => null)) ?? undefined;
        return { name, screenName, iconUrl };
    }

    private async waitForTweets(page: Page): Promise<void> {
        await page
            .locator('article[data-testid="tweet"]')
            .first()
            .waitFor({ state: 'attached', timeout: 15_000 })
            .catch(() => undefined);
        await page.waitForTimeout(1_000);
    }

    private async readTweets(page: Page): Promise<apid.TwitterTweet[]> {
        const tweets = await page.locator('article[data-testid="tweet"]').evaluateAll((articles): ParsedTweet[] => {
            const metric = (article: Element, testId: string): number => {
                const element = article.querySelector(`[data-testid="${testId}"]`);
                const label = element?.getAttribute('aria-label') ?? element?.textContent ?? '';
                const match = label.replace(/,/g, '').match(/\d+/);
                return match === null ? 0 : Number(match[0]);
            };
            return articles.slice(0, 40).flatMap(article => {
                const statusLinks = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'));
                const statusLink = statusLinks.find(link =>
                    /^\/[^/]+\/status\/\d+/.test(link.getAttribute('href') ?? ''),
                );
                const href = statusLink?.getAttribute('href') ?? '';
                const match = href.match(/^\/([^/]+)\/status\/(\d+)/);
                if (match === null) return [];
                const userName = article.querySelector('[data-testid="User-Name"]')?.textContent ?? '';
                const authorName = userName.split(`@${match[1]}`)[0]?.trim() || match[1];
                const timeValue = article.querySelector('time')?.getAttribute('datetime');
                const createdAt = timeValue === null || timeValue === undefined ? undefined : Date.parse(timeValue);
                const imageUrls = Array.from(
                    article.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img'),
                )
                    .map(image => image.src)
                    .filter((url, index, values) => url.length > 0 && values.indexOf(url) === index);
                return [
                    {
                        source: 'twitter',
                        id: match[2],
                        url: `https://x.com${href}`,
                        text: article.querySelector('[data-testid="tweetText"]')?.textContent ?? '',
                        authorName,
                        authorScreenName: match[1],
                        authorIconUrl: article.querySelector<HTMLImageElement>('img[src*="profile_images"]')?.src,
                        createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
                        imageUrls,
                        replyCount: metric(article, 'reply'),
                        retweetCount: metric(
                            article,
                            article.querySelector('[data-testid="unretweet"]') === null ? 'retweet' : 'unretweet',
                        ),
                        likeCount: metric(
                            article,
                            article.querySelector('[data-testid="unlike"]') === null ? 'like' : 'unlike',
                        ),
                        retweeted: article.querySelector('[data-testid="unretweet"]') !== null,
                        liked: article.querySelector('[data-testid="unlike"]') !== null,
                    },
                ];
            });
        });
        return tweets;
    }

    private parseNetscapeCookies(cookiesText: string): TwitterCookie[] {
        const result: TwitterCookie[] = [];
        for (const rawLine of cookiesText.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (line.length === 0 || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
            const fields = line.replace(/^#HttpOnly_/, '').split('\t');
            if (fields.length < 7) continue;
            const [domain, , cookiePath, secure, expires, name, ...valueParts] = fields;
            if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(domain.replace(/^\./, ''))) continue;
            const expiresNumber = Number(expires);
            result.push({
                name,
                value: valueParts.join('\t'),
                domain,
                path: cookiePath || '/',
                secure: secure.toUpperCase() === 'TRUE',
                httpOnly: rawLine.startsWith('#HttpOnly_'),
                ...(Number.isFinite(expiresNumber) && expiresNumber > 0 ? { expires: expiresNumber } : {}),
                sameSite: 'Lax',
            });
        }
        if (result.length === 0) throw new Error('有効なx.comのCookieが見つかりません');
        return result;
    }

    private async readCredential(viewerProfileId: number): Promise<StoredTwitterCredential | null> {
        const value = await this.viewerProfileApiModel.getCredential(viewerProfileId, TwitterApiModel.PROVIDER);
        if (value === null) return null;
        try {
            const parsed = JSON.parse(value) as Partial<StoredTwitterCredential>;
            if (
                typeof parsed.cookiesText !== 'string' ||
                typeof parsed.account?.name !== 'string' ||
                typeof parsed.account.screenName !== 'string'
            ) {
                throw new Error('InvalidCredential');
            }
            return parsed as StoredTwitterCredential;
        } catch {
            throw new Error('保存済みTwitter資格情報が不正です。設定から再連携してください');
        }
    }

    private credentialFingerprint(credential: StoredTwitterCredential): string {
        return createHash('sha256')
            .update(credential.cookiesText)
            .update('\0')
            .update(credential.userAgent ?? '')
            .digest('hex');
    }

    private touchSession(session: TwitterBrowserSession, viewerProfileId?: number): void {
        if (session.idleTimer !== null) clearTimeout(session.idleTimer);
        const id =
            viewerProfileId ?? Array.from(this.sessions.entries()).find(([, candidate]) => candidate === session)?.[0];
        if (id === undefined) return;
        session.idleTimer = setTimeout(() => {
            void this.closeSession(id, session);
        }, TwitterApiModel.IDLE_TIMEOUT);
    }

    private async closeSession(viewerProfileId: number, expectedSession?: TwitterBrowserSession): Promise<void> {
        const session = this.sessions.get(viewerProfileId);
        if (expectedSession !== undefined && session !== expectedSession) return;
        this.sessionGenerations.set(viewerProfileId, (this.sessionGenerations.get(viewerProfileId) ?? 0) + 1);
        if (session === undefined) return;
        this.sessions.delete(viewerProfileId);
        if (session.idleTimer !== null) clearTimeout(session.idleTimer);
        await session.queue.catch(() => undefined);
        await session.context.close().catch(() => undefined);
        await session.browser.close().catch(() => undefined);
    }
}
