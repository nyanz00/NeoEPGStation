import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IViewerProfileApiModel from '../viewerProfile/IViewerProfileApiModel';
import IBlueskyApiModel from './IBlueskyApiModel';

interface BlueskySessionResponse {
    accessJwt: string;
    refreshJwt: string;
    did: string;
    handle: string;
    didDoc?: {
        service?: Array<{
            id?: string;
            type?: string;
            serviceEndpoint?: string;
        }>;
    };
}

interface StoredBlueskyCredential {
    serviceEndpoint: string;
    accessJwt: string;
    refreshJwt: string;
    did: string;
    handle: string;
    account: apid.BlueskyAccountInfo;
}

interface BlueskyPostView {
    uri?: string;
    cid?: string;
    author?: {
        did?: string;
        handle?: string;
        displayName?: string;
        avatar?: string;
    };
    record?: {
        text?: string;
        createdAt?: string;
    };
    embed?: unknown;
    replyCount?: number;
    repostCount?: number;
    likeCount?: number;
    viewer?: {
        repost?: string;
        like?: string;
    };
}

@injectable()
export default class BlueskyApiModel implements IBlueskyApiModel {
    private static readonly PROVIDER = 'bluesky';
    private static readonly ENTRYWAY = 'https://bsky.social';
    private readonly refreshes = new Map<number, Promise<StoredBlueskyCredential>>();

    constructor(
        @inject('IViewerProfileApiModel')
        private viewerProfileApiModel: IViewerProfileApiModel,
    ) {}

    public async getStatus(viewerProfileId?: apid.ViewerProfileId): Promise<apid.BlueskyStatus> {
        if (viewerProfileId === undefined) return { configured: false };
        const credential = await this.readCredential(viewerProfileId);
        return credential === null
            ? { configured: false, viewerProfileId }
            : { configured: true, viewerProfileId, account: credential.account };
    }

    public async connect(
        viewerProfileId: apid.ViewerProfileId,
        handle: string,
        appPassword: string,
    ): Promise<apid.BlueskyStatus> {
        const identifier = handle.trim().replace(/^@/, '').toLowerCase();
        const password = appPassword.trim();
        if (identifier.length === 0 || identifier.length > 253 || !identifier.includes('.')) {
            throw new Error('Blueskyハンドルが不正です');
        }
        if (!/^[a-z0-9]{4}(?:-[a-z0-9]{4}){3}$/i.test(password)) {
            throw new Error('Blueskyで発行したApp Passwordを入力してください');
        }

        let session: BlueskySessionResponse;
        try {
            session = (
                await axios.post<BlueskySessionResponse>(
                    `${BlueskyApiModel.ENTRYWAY}/xrpc/com.atproto.server.createSession`,
                    { identifier, password },
                    { timeout: 20_000 },
                )
            ).data;
        } catch (error) {
            throw this.apiError(error, 'Blueskyへログインできませんでした。ハンドルとApp Passwordを確認してください');
        }
        const serviceEndpoint =
            session.didDoc?.service?.find(
                service =>
                    service.id?.endsWith('#atproto_pds') === true &&
                    typeof service.serviceEndpoint === 'string' &&
                    service.serviceEndpoint.startsWith('https://'),
            )?.serviceEndpoint ?? BlueskyApiModel.ENTRYWAY;
        const temporary: StoredBlueskyCredential = {
            serviceEndpoint,
            accessJwt: session.accessJwt,
            refreshJwt: session.refreshJwt,
            did: session.did,
            handle: session.handle,
            account: {
                name: session.handle,
                handle: session.handle,
                did: session.did,
            },
        };
        let profile: {
            displayName?: string;
            handle?: string;
            did?: string;
            avatar?: string;
        };
        try {
            profile = (
                await axios.get(`${serviceEndpoint}/xrpc/app.bsky.actor.getProfile`, {
                    params: { actor: session.did },
                    headers: { Authorization: `Bearer ${session.accessJwt}` },
                    timeout: 20_000,
                })
            ).data;
        } catch (error) {
            throw this.apiError(error, 'Blueskyプロフィールを取得できませんでした');
        }
        const account: apid.BlueskyAccountInfo = {
            name: profile.displayName?.trim() || profile.handle || session.handle,
            handle: profile.handle || session.handle,
            did: profile.did || session.did,
            iconUrl: profile.avatar,
        };
        await this.writeCredential(viewerProfileId, { ...temporary, account });
        return { configured: true, viewerProfileId, account };
    }

    public async disconnect(viewerProfileId: apid.ViewerProfileId): Promise<void> {
        this.refreshes.delete(viewerProfileId);
        await this.viewerProfileApiModel.deleteCredential(viewerProfileId, BlueskyApiModel.PROVIDER);
    }

    public async getTimeline(viewerProfileId: apid.ViewerProfileId): Promise<apid.TwitterTimeline> {
        const data = await this.request<{
            feed?: Array<{ post?: BlueskyPostView }>;
        }>(viewerProfileId, {
            method: 'GET',
            url: '/xrpc/app.bsky.feed.getTimeline',
            params: { limit: 40 },
        });
        return {
            tweets: (data.feed ?? []).flatMap(item => (item.post === undefined ? [] : [this.toTweet(item.post)])),
            refreshedAt: Date.now(),
        };
    }

    public async search(viewerProfileId: apid.ViewerProfileId, query: string): Promise<apid.TwitterTimeline> {
        const normalized = query.trim();
        if (normalized.length === 0 || normalized.length > 500) throw new Error('検索キーワードが不正です');
        const data = await this.request<{ posts?: BlueskyPostView[] }>(viewerProfileId, {
            method: 'GET',
            url: '/xrpc/app.bsky.feed.searchPosts',
            params: { q: normalized, limit: 40, sort: 'latest' },
        });
        return {
            tweets: (data.posts ?? []).map(post => this.toTweet(post)),
            refreshedAt: Date.now(),
        };
    }

    public async post(viewerProfileId: apid.ViewerProfileId, text: string): Promise<void> {
        const normalized = text.trim();
        if (normalized.length === 0) throw new Error('投稿内容を入力してください');
        if (Array.from(normalized).length > 300) throw new Error('投稿内容が300文字を超えています');
        const credential = await this.requireCredential(viewerProfileId);
        await this.request(viewerProfileId, {
            method: 'POST',
            url: '/xrpc/com.atproto.repo.createRecord',
            data: {
                repo: credential.did,
                collection: 'app.bsky.feed.post',
                record: {
                    $type: 'app.bsky.feed.post',
                    text: normalized,
                    createdAt: new Date().toISOString(),
                },
            },
        });
    }

    private async request<T>(viewerProfileId: number, config: AxiosRequestConfig, retried = false): Promise<T> {
        const credential = await this.requireCredential(viewerProfileId);
        try {
            return (
                await axios.request<T>({
                    ...config,
                    baseURL: credential.serviceEndpoint,
                    timeout: 20_000,
                    headers: {
                        ...config.headers,
                        Authorization: `Bearer ${credential.accessJwt}`,
                    },
                })
            ).data;
        } catch (error) {
            if (!retried && axios.isAxiosError(error) && error.response?.status === 401) {
                await this.refreshCredential(viewerProfileId);
                return this.request<T>(viewerProfileId, config, true);
            }
            throw this.apiError(error, 'Bluesky APIへの接続に失敗しました');
        }
    }

    private async refreshCredential(viewerProfileId: number): Promise<StoredBlueskyCredential> {
        const currentRefresh = this.refreshes.get(viewerProfileId);
        if (currentRefresh !== undefined) return currentRefresh;
        const refresh = (async (): Promise<StoredBlueskyCredential> => {
            const credential = await this.requireCredential(viewerProfileId);
            try {
                const session = (
                    await axios.post<BlueskySessionResponse>(
                        `${credential.serviceEndpoint}/xrpc/com.atproto.server.refreshSession`,
                        undefined,
                        {
                            headers: { Authorization: `Bearer ${credential.refreshJwt}` },
                            timeout: 20_000,
                        },
                    )
                ).data;
                const updated: StoredBlueskyCredential = {
                    ...credential,
                    accessJwt: session.accessJwt,
                    refreshJwt: session.refreshJwt,
                    did: session.did || credential.did,
                    handle: session.handle || credential.handle,
                    account: {
                        ...credential.account,
                        did: session.did || credential.account.did,
                        handle: session.handle || credential.account.handle,
                    },
                };
                await this.writeCredential(viewerProfileId, updated);
                return updated;
            } catch (error) {
                throw this.apiError(error, 'Blueskyのセッションを更新できませんでした。設定から再連携してください');
            }
        })();
        this.refreshes.set(viewerProfileId, refresh);
        try {
            return await refresh;
        } finally {
            this.refreshes.delete(viewerProfileId);
        }
    }

    private async requireCredential(viewerProfileId: number): Promise<StoredBlueskyCredential> {
        const credential = await this.readCredential(viewerProfileId);
        if (credential === null) throw new Error('Blueskyアカウントが連携されていません');
        return credential;
    }

    private async readCredential(viewerProfileId: number): Promise<StoredBlueskyCredential | null> {
        const value = await this.viewerProfileApiModel.getCredential(viewerProfileId, BlueskyApiModel.PROVIDER);
        if (value === null) return null;
        try {
            const credential = JSON.parse(value) as StoredBlueskyCredential;
            if (
                typeof credential.serviceEndpoint !== 'string' ||
                !credential.serviceEndpoint.startsWith('https://') ||
                typeof credential.accessJwt !== 'string' ||
                typeof credential.refreshJwt !== 'string' ||
                typeof credential.did !== 'string' ||
                typeof credential.handle !== 'string' ||
                typeof credential.account?.handle !== 'string'
            ) {
                throw new Error('InvalidCredential');
            }
            return credential;
        } catch {
            throw new Error('保存済みBluesky資格情報が不正です。設定から再連携してください');
        }
    }

    private async writeCredential(viewerProfileId: number, credential: StoredBlueskyCredential): Promise<void> {
        await this.viewerProfileApiModel.setCredential(
            viewerProfileId,
            BlueskyApiModel.PROVIDER,
            JSON.stringify(credential),
        );
    }

    private toTweet(post: BlueskyPostView): apid.TwitterTweet {
        const handle = post.author?.handle || 'unknown.bsky.social';
        const uriParts = post.uri?.split('/') ?? [];
        const recordKey =
            uriParts[uriParts.length - 1] || post.cid || post.uri || `${handle}-${Date.now().toString(10)}`;
        const createdAt = Date.parse(post.record?.createdAt ?? '');
        return {
            source: 'bluesky',
            id: post.uri || recordKey,
            url: `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(recordKey)}`,
            text: post.record?.text ?? '',
            authorName: post.author?.displayName?.trim() || handle,
            authorScreenName: handle,
            authorIconUrl: post.author?.avatar,
            createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
            imageUrls: this.imageUrls(post.embed),
            replyCount: post.replyCount ?? 0,
            retweetCount: post.repostCount ?? 0,
            likeCount: post.likeCount ?? 0,
            retweeted: typeof post.viewer?.repost === 'string',
            liked: typeof post.viewer?.like === 'string',
        };
    }

    private imageUrls(embed: unknown): string[] {
        if (embed === null || typeof embed !== 'object') return [];
        const value = embed as {
            images?: Array<{ thumb?: string; fullsize?: string }>;
            media?: unknown;
        };
        const direct = (value.images ?? [])
            .map(image => image.thumb || image.fullsize || '')
            .filter(url => url.length > 0);
        return [...direct, ...this.imageUrls(value.media)].filter(
            (url, index, values) => values.indexOf(url) === index,
        );
    }

    private apiError(error: unknown, fallback: string): Error {
        if (!(error instanceof AxiosError) && !axios.isAxiosError(error)) {
            return new Error(`${fallback}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const detail = error.response?.data as { error?: string; message?: string } | undefined;
        const message = detail?.message || detail?.error;
        return new Error(message === undefined ? fallback : `${fallback}: ${message}`);
    }
}
