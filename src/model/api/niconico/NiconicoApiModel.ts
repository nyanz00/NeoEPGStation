import axios, { AxiosResponse, Method } from 'axios';
import { inject, injectable } from 'inversify';
import WebSocket, { RawData } from 'ws';
import * as apid from '../../../../api';
import IChannelApiModel from '../channel/IChannelApiModel';
import IViewerProfileApiModel from '../viewerProfile/IViewerProfileApiModel';
import INiconicoApiModel from './INiconicoApiModel';

interface StoredCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
}

interface StoredNiconicoCredential {
    cookies: StoredCookie[];
    account: apid.NiconicoAccountInfo;
}

interface ManualResponse {
    response: AxiosResponse<string>;
    finalUrl: string;
}

class NiconicoCookieJar {
    private readonly cookies = new Map<string, StoredCookie>();

    constructor(initial: StoredCookie[] = []) {
        initial.forEach(cookie => this.set(cookie));
    }

    public addResponseCookies(requestUrl: string, values?: string[]): void {
        if (values === undefined) return;
        const request = new URL(requestUrl);
        for (const value of values) {
            const parts = value.split(';');
            const separator = parts[0].indexOf('=');
            if (separator <= 0) continue;
            const cookie: StoredCookie = {
                name: parts[0].slice(0, separator).trim(),
                value: parts[0].slice(separator + 1),
                domain: request.hostname.toLowerCase(),
                path: '/',
                secure: false,
            };
            let remove = false;
            for (const rawAttribute of parts.slice(1)) {
                const attribute = rawAttribute.trim();
                const attributeSeparator = attribute.indexOf('=');
                const name = (attributeSeparator < 0 ? attribute : attribute.slice(0, attributeSeparator))
                    .trim()
                    .toLowerCase();
                const attributeValue = attributeSeparator < 0 ? '' : attribute.slice(attributeSeparator + 1).trim();
                if (name === 'domain' && attributeValue.length > 0) cookie.domain = attributeValue.toLowerCase();
                else if (name === 'path' && attributeValue.startsWith('/')) cookie.path = attributeValue;
                else if (name === 'secure') cookie.secure = true;
                else if (name === 'max-age' && Number(attributeValue) <= 0) remove = true;
                else if (
                    name === 'expires' &&
                    Number.isFinite(Date.parse(attributeValue)) &&
                    Date.parse(attributeValue) <= Date.now()
                ) {
                    remove = true;
                }
            }
            const key = this.key(cookie);
            if (remove || cookie.value.length === 0) this.cookies.delete(key);
            else this.cookies.set(key, cookie);
        }
    }

    public header(requestUrl: string): string {
        const request = new URL(requestUrl);
        return Array.from(this.cookies.values())
            .filter(cookie => {
                const domain = cookie.domain.replace(/^\./, '');
                return (
                    (request.hostname === domain || request.hostname.endsWith(`.${domain}`)) &&
                    request.pathname.startsWith(cookie.path) &&
                    (!cookie.secure || request.protocol === 'https:')
                );
            })
            .map(cookie => `${cookie.name}=${cookie.value}`)
            .join('; ');
    }

    public stored(): StoredCookie[] {
        return Array.from(this.cookies.values()).filter(cookie =>
            ['nicosid', 'user_session', 'user_session_secure', 'mfa_trusted_device_token'].includes(cookie.name),
        );
    }

    private set(cookie: StoredCookie): void {
        this.cookies.set(this.key(cookie), { ...cookie, domain: cookie.domain.toLowerCase() });
    }

    private key(cookie: StoredCookie): string {
        return `${cookie.domain.replace(/^\./, '')}\0${cookie.path}\0${cookie.name}`;
    }
}

@injectable()
export default class NiconicoApiModel implements INiconicoApiModel {
    private static readonly PROVIDER = 'niconico';
    private static readonly MINIMUM_POST_INTERVAL = 2_000;
    private static readonly NICOCHANNEL_IDS: Record<string, string> = {
        jk1: 'ch2646436',
        jk2: 'ch2646437',
        jk4: 'ch2646438',
        jk5: 'ch2646439',
        jk6: 'ch2646440',
        jk7: 'ch2646441',
        jk8: 'ch2646442',
        jk9: 'ch2646485',
        jk101: 'ch2647992',
        jk211: 'ch2646846',
    };
    private readonly lastPostAt = new Map<number, number>();

    constructor(
        @inject('IViewerProfileApiModel') private viewerProfileApiModel: IViewerProfileApiModel,
        @inject('IChannelApiModel') private channelApiModel: IChannelApiModel,
    ) {}

    public async getStatus(viewerProfileId?: number): Promise<apid.NiconicoStatus> {
        if (viewerProfileId === undefined) return { configured: false };
        const credential = await this.readCredential(viewerProfileId);
        return credential === null
            ? { configured: false, viewerProfileId }
            : { configured: true, viewerProfileId, account: credential.account };
    }

    public async login(viewerProfileId: number, option: apid.NiconicoLoginOption): Promise<apid.NiconicoLoginResult> {
        const cookiesText = option.cookiesText.trim();
        if (cookiesText.length === 0) throw new Error('ニコニコのcookies.txtを入力してください');
        if (cookiesText.length > 256 * 1024) throw new Error('ニコニコのcookies.txtが大きすぎます');
        const jar = new NiconicoCookieJar(this.parseNetscapeCookies(cookiesText));
        return this.finishLogin(viewerProfileId, jar);
    }

    public async disconnect(viewerProfileId: number): Promise<void> {
        this.lastPostAt.delete(viewerProfileId);
        await this.viewerProfileApiModel.deleteCredential(viewerProfileId, NiconicoApiModel.PROVIDER);
    }

    public async getJikkyoInfo(channelId: number, viewerProfileId?: number): Promise<apid.ChannelJikkyoInfo> {
        const base = await this.channelApiModel.getJikkyoInfo(channelId);
        const fallback: apid.ChannelJikkyoInfo = {
            ...base,
            nicoliveWatchSessionError: null,
            canPost: false,
            postingTarget: null,
        };
        if (base.jikkyoId === null || viewerProfileId === undefined) return fallback;
        const credential = await this.readCredential(viewerProfileId);
        if (credential === null) return fallback;
        const postingFallback: apid.ChannelJikkyoInfo = {
            ...fallback,
            canPost: true,
            postingTarget: 'nx-jikkyo',
        };
        if (NiconicoApiModel.NICOCHANNEL_IDS[base.jikkyoId] === undefined) return postingFallback;
        // Do not access Niconico here. This endpoint is opened alongside the live
        // stream, so following Niconico page redirects here can delay player startup
        // and, after player retries, exhaust the browser's per-host connection pool.
        // Resolve the current official program only when the user actually posts.
        return { ...fallback, canPost: true, postingTarget: 'nicolive' };
    }

    public async postComment(viewerProfileId: number, option: apid.NiconicoCommentOption): Promise<void> {
        const text = option.text.trim();
        if (text.length === 0) throw new Error('コメントを入力してください');
        if (Array.from(text).length > 75) throw new Error('コメントは75文字以内で入力してください');
        if (!['white', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue'].includes(option.color)) {
            throw new Error('コメント色が不正です');
        }
        if (
            !['top', 'right', 'bottom'].includes(option.position) ||
            !['big', 'medium', 'small'].includes(option.size)
        ) {
            throw new Error('コメント表示設定が不正です');
        }
        const previous = this.lastPostAt.get(viewerProfileId) ?? 0;
        const wait = NiconicoApiModel.MINIMUM_POST_INTERVAL - (Date.now() - previous);
        if (wait > 0) throw new Error(`連続投稿を避けるため${Math.ceil(wait / 1000).toString(10)}秒待ってください`);
        const credential = await this.readCredential(viewerProfileId);
        if (credential === null) throw new Error('ニコニコアカウントが連携されていません');
        if (credential.account.isPremium === false && (option.position !== 'right' || option.size === 'big')) {
            throw new Error('このコメント表示設定はニコニコのプレミアム会員だけが利用できます');
        }
        const base = await this.channelApiModel.getJikkyoInfo(option.channelId);
        if (base.jikkyoId === null || NiconicoApiModel.NICOCHANNEL_IDS[base.jikkyoId] === undefined) {
            throw new Error('このチャンネルはニコニコ公式実況への投稿対象ではありません');
        }
        const programId = await this.findCurrentProgram(base.jikkyoId);
        if (programId === null) throw new Error('現在放送中のニコニコ実況番組が見つかりませんでした');
        const webSocketUrl = await this.getNicoliveWebSocketUrl(programId, credential);
        await this.postNicoliveComment(webSocketUrl, credential, {
            ...option,
            text,
        });
        this.lastPostAt.set(viewerProfileId, Date.now());
    }

    private async finishLogin(viewerProfileId: number, jar: NiconicoCookieJar): Promise<apid.NiconicoLoginResult> {
        const response = await this.requestFollowingRedirects('GET', 'https://www.nicovideo.jp/', undefined, jar);
        const userId = this.headerString(response.response.headers['x-niconico-id']);
        if (userId === null || !/^[0-9]+$/.test(userId)) {
            throw new Error('ニコニコへログインできませんでした。入力内容やアカウント状態を確認してください');
        }
        const cookies = jar.stored();
        if (!cookies.some(cookie => ['user_session', 'user_session_secure'].includes(cookie.name))) {
            throw new Error('cookies.txtにニコニコのログインセッションが含まれていません');
        }
        const account = await this.fetchAccount(userId);
        await this.writeCredential(viewerProfileId, { cookies, account });
        return { status: 'connected', account };
    }

    private async fetchAccount(userId: string): Promise<apid.NiconicoAccountInfo> {
        const response = await axios.get(`https://nvapi.nicovideo.jp/v1/users/${userId}`, {
            headers: { 'X-Frontend-Id': '6', 'User-Agent': this.userAgent() },
            timeout: 10_000,
        });
        const user = response.data?.data?.user;
        if (typeof user?.nickname !== 'string') throw new Error('ニコニコのプロフィールを取得できませんでした');
        return { userId, name: user.nickname, isPremium: user.isPremium === true };
    }

    private async findCurrentProgram(jikkyoId: string): Promise<string | null> {
        const nicochannelId = NiconicoApiModel.NICOCHANNEL_IDS[jikkyoId];
        if (nicochannelId === undefined) return null;
        const html = (
            await axios.get<string>(`https://ch.nicovideo.jp/${nicochannelId}/live`, {
                timeout: 10_000,
                responseType: 'text',
                headers: { 'User-Agent': this.userAgent() },
            })
        ).data;
        return html.match(/https:\/\/live\.nicovideo\.jp\/watch\/(lv[0-9]+)/)?.[1] ?? null;
    }

    private async getNicoliveWebSocketUrl(programId: string, credential: StoredNiconicoCredential): Promise<string> {
        const jar = new NiconicoCookieJar(credential.cookies);
        const result = await this.requestFollowingRedirects(
            'GET',
            `https://live.nicovideo.jp/watch/${programId}`,
            undefined,
            jar,
        );
        if (
            /^https:\/\/account\.nicovideo\.jp\/login|^https:\/\/account\.nicovideo\.jp\/my\/account/i.test(
                result.finalUrl,
            )
        ) {
            throw new Error('NiconicoSessionExpired');
        }
        const match = result.response.data.match(
            /<script(?=[^>]*\bid=["']embedded-data["'])[^>]*\bdata-props=["']([^"']+)["'][^>]*>/i,
        );
        if (match === null) throw new Error('NiconicoEmbeddedDataNotFound');
        let embedded: any;
        try {
            embedded = JSON.parse(this.decodeHtmlAttribute(match[1]));
        } catch {
            throw new Error('NiconicoEmbeddedDataInvalid');
        }
        const value = embedded?.site?.relive?.webSocketUrl;
        if (typeof value !== 'string' || !/^wss:\/\/[0-9A-Za-z.-]+\.nicovideo\.jp\//.test(value)) {
            throw new Error('NiconicoWebSocketUrlNotFound');
        }
        return value;
    }

    private async postNicoliveComment(
        webSocketUrl: string,
        credential: StoredNiconicoCredential,
        option: apid.NiconicoCommentOption,
    ): Promise<void> {
        const cookie = new NiconicoCookieJar(credential.cookies).header('https://live.nicovideo.jp/');
        await new Promise<void>((resolve, reject) => {
            const socket = new WebSocket(webSocketUrl, {
                headers: {
                    Cookie: cookie,
                    Origin: 'https://live.nicovideo.jp',
                    'User-Agent': this.userAgent(),
                },
            });
            let finished = false;
            let posted = false;
            let keepSeatTimer: NodeJS.Timeout | null = null;
            const timeout = setTimeout(() => finish(new Error('ニコニコ実況への投稿がタイムアウトしました')), 15_000);
            const finish = (error?: Error): void => {
                if (finished) return;
                finished = true;
                clearTimeout(timeout);
                if (keepSeatTimer !== null) clearInterval(keepSeatTimer);
                try {
                    if (socket.readyState === WebSocket.CONNECTING) {
                        socket.terminate();
                    } else if (socket.readyState === WebSocket.OPEN) {
                        socket.close();
                    }
                } catch {
                    // The posting result has already been decided. Cleanup errors must not mask it.
                }
                if (error === undefined) resolve();
                else reject(error);
            };
            const post = (vposBaseTime: unknown): void => {
                if (posted || typeof vposBaseTime !== 'string') return;
                const base = Date.parse(vposBaseTime);
                if (!Number.isFinite(base)) return;
                posted = true;
                socket.send(
                    JSON.stringify({
                        type: 'postComment',
                        data: {
                            text: option.text,
                            color: option.color,
                            position: { top: 'ue', right: 'naka', bottom: 'shita' }[option.position],
                            size: option.size,
                            vpos: Math.max(0, Math.round((Date.now() - base) / 10)),
                            isAnonymous: true,
                        },
                    }),
                );
            };
            socket.on('open', () => {
                socket.send(JSON.stringify({ type: 'startWatching', data: { reconnect: false } }));
            });
            socket.on('message', (raw: RawData) => {
                let message: any;
                try {
                    message = JSON.parse(raw.toString());
                } catch {
                    return;
                }
                if (message.type === 'seat' && keepSeatTimer === null) {
                    const interval = Math.max(Number(message.data?.keepIntervalSec) || 30, 5) * 1000;
                    keepSeatTimer = setInterval(() => {
                        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'keepSeat' }));
                    }, interval);
                } else if (message.type === 'ping') {
                    socket.send(JSON.stringify({ type: 'pong' }));
                } else if (message.type === 'room' || message.type === 'messageServer') {
                    post(message.data?.vposBaseTime);
                } else if (message.type === 'postCommentResult') {
                    finish();
                } else if (message.type === 'error') {
                    finish(new Error(this.nicoliveErrorMessage(message.data?.code)));
                } else if (message.type === 'disconnect') {
                    finish(new Error('ニコニコ実況との接続が切断されました'));
                }
            });
            socket.on('error', error => finish(new Error(`ニコニコ実況へ接続できませんでした: ${error.message}`)));
            socket.on('close', () => {
                if (!finished) finish(new Error('ニコニコ実況との接続が終了しました'));
            });
        });
    }

    private async requestFollowingRedirects(
        method: Method,
        initialUrl: string,
        data: URLSearchParams | undefined,
        jar: NiconicoCookieJar,
        headers: Record<string, string> = {},
    ): Promise<ManualResponse> {
        let currentUrl = initialUrl;
        let currentMethod = method;
        let currentData = data;
        for (let redirects = 0; redirects <= 10; redirects += 1) {
            this.assertNiconicoUrl(currentUrl);
            const cookie = jar.header(currentUrl);
            const response = await axios.request<string>({
                method: currentMethod,
                url: currentUrl,
                data: currentData,
                headers: {
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'User-Agent': this.userAgent(),
                    ...headers,
                    ...(cookie.length === 0 ? {} : { Cookie: cookie }),
                },
                maxRedirects: 0,
                timeout: 20_000,
                responseType: 'text',
                validateStatus: status => 200 <= status && status < 400,
            });
            jar.addResponseCookies(currentUrl, response.headers['set-cookie']);
            const location = this.headerString(response.headers.location);
            if (![301, 302, 303, 307, 308].includes(response.status) || location === null) {
                return { response, finalUrl: currentUrl };
            }
            currentUrl = new URL(location, currentUrl).toString();
            if ([301, 302, 303].includes(response.status) && currentMethod !== 'GET') {
                currentMethod = 'GET';
                currentData = undefined;
            }
        }
        throw new Error('ニコニコのログインでリダイレクトが繰り返されました');
    }

    private assertNiconicoUrl(value: string): void {
        const url = new URL(value);
        if (
            url.protocol !== 'https:' ||
            !['account.nicovideo.jp', 'www.nicovideo.jp', 'live.nicovideo.jp', 'nicovideo.jp'].includes(url.hostname)
        ) {
            throw new Error('ニコニコのログイン先が不正です');
        }
    }

    private decodeHtmlAttribute(value: string): string {
        return value
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
            .replace(/&#([0-9]+);/g, (_match, code) => String.fromCodePoint(parseInt(code, 10)))
            .replace(/&amp;/gi, '&');
    }

    private nicoliveErrorMessage(code: unknown): string {
        if (code === 'COMMENT_POST_NOT_ALLOWED') return 'ニコニコ実況へのコメント投稿が許可されていません';
        if (code === 'INVALID_MESSAGE') return 'コメント内容が無効です';
        return `ニコニコ実況でエラーが発生しました${typeof code === 'string' ? ` (${code})` : ''}`;
    }

    private userAgent(): string {
        return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36';
    }

    private headerString(value: unknown): string | null {
        if (typeof value === 'string') return value;
        if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
        return null;
    }

    private parseNetscapeCookies(cookiesText: string): StoredCookie[] {
        const cookies: StoredCookie[] = [];
        for (const rawLine of cookiesText.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (line.length === 0 || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
            const fields = line.replace(/^#HttpOnly_/, '').split('\t');
            if (fields.length < 7) continue;
            const [domain, , cookiePath, secure, expires, name, ...valueParts] = fields;
            const normalizedDomain = domain.toLowerCase().replace(/^\./, '');
            if (normalizedDomain !== 'nicovideo.jp' && !normalizedDomain.endsWith('.nicovideo.jp')) continue;
            if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) continue;
            const value = valueParts.join('\t');
            if (value.length === 0 || /[\r\n]/.test(value)) continue;
            const expiresAt = Number(expires);
            if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt * 1000 <= Date.now()) continue;
            cookies.push({
                name,
                value,
                domain,
                path: cookiePath.startsWith('/') ? cookiePath : '/',
                secure: secure.toUpperCase() === 'TRUE',
            });
        }
        if (!cookies.some(cookie => ['user_session', 'user_session_secure'].includes(cookie.name))) {
            throw new Error('有効なnicovideo.jpのログインCookieが見つかりません');
        }
        return cookies;
    }

    private async readCredential(viewerProfileId: number): Promise<StoredNiconicoCredential | null> {
        const raw = await this.viewerProfileApiModel.getCredential(viewerProfileId, NiconicoApiModel.PROVIDER);
        if (raw === null) return null;
        try {
            const value = JSON.parse(raw) as StoredNiconicoCredential & {
                accessToken?: unknown;
                refreshToken?: unknown;
            };
            if (
                !Array.isArray(value.cookies) &&
                (typeof value.accessToken === 'string' || typeof value.refreshToken === 'string')
            ) {
                await this.viewerProfileApiModel.deleteCredential(viewerProfileId, NiconicoApiModel.PROVIDER);
                return null;
            }
            if (
                !Array.isArray(value.cookies) ||
                value.cookies.some(
                    cookie =>
                        typeof cookie?.name !== 'string' ||
                        typeof cookie.value !== 'string' ||
                        typeof cookie.domain !== 'string' ||
                        typeof cookie.path !== 'string' ||
                        typeof cookie.secure !== 'boolean',
                ) ||
                typeof value.account?.userId !== 'string' ||
                typeof value.account?.name !== 'string' ||
                typeof value.account?.isPremium !== 'boolean'
            ) {
                throw new Error('InvalidCredential');
            }
            return value;
        } catch {
            throw new Error('保存済みニコニコ資格情報が旧形式または不正です。設定から再連携してください');
        }
    }

    private async writeCredential(viewerProfileId: number, credential: StoredNiconicoCredential): Promise<void> {
        await this.viewerProfileApiModel.setCredential(
            viewerProfileId,
            NiconicoApiModel.PROVIDER,
            JSON.stringify(credential),
        );
    }
}
