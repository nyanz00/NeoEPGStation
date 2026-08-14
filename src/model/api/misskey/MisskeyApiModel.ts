import axios, { AxiosError } from 'axios';
import { randomUUID } from 'crypto';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IViewerProfileApiModel from '../viewerProfile/IViewerProfileApiModel';
import IMisskeyApiModel from './IMisskeyApiModel';

interface StoredMisskeyCredential {
    accessToken: string;
    visibility: apid.MisskeyVisibility;
    account: apid.MisskeyAccountInfo;
}

interface MisskeyUser {
    id?: string;
    username?: string;
    name?: string | null;
    host?: string | null;
    avatarUrl?: string | null;
}

interface PendingMisskeyAuthorization {
    viewerProfileId: apid.ViewerProfileId;
    visibility: apid.MisskeyVisibility;
    expiresAt: number;
}

interface MisskeyAuthorizationResponse {
    ok?: boolean;
    token?: string;
    user?: MisskeyUser;
}

interface MisskeyNote {
    id?: string;
    text?: string | null;
    createdAt?: string;
    user?: MisskeyUser;
    files?: Array<{ type?: string; url?: string; thumbnailUrl?: string }>;
    repliesCount?: number;
    renoteCount?: number;
    reactions?: Record<string, number>;
    myReaction?: string | null;
    renote?: MisskeyNote | null;
}

@injectable()
export default class MisskeyApiModel implements IMisskeyApiModel {
    private static readonly PROVIDER = 'misskey';
    private static readonly INSTANCE = 'misskey.io';
    private static readonly API_BASE = `https://${MisskeyApiModel.INSTANCE}/api`;
    private static readonly AUTHORIZATION_TTL = 10 * 60 * 1000;
    private pendingAuthorizations = new Map<string, PendingMisskeyAuthorization>();

    constructor(
        @inject('IViewerProfileApiModel')
        private viewerProfileApiModel: IViewerProfileApiModel,
    ) {}

    public async getStatus(viewerProfileId?: apid.ViewerProfileId): Promise<apid.MisskeyStatus> {
        if (viewerProfileId === undefined) return { configured: false };
        const credential = await this.readCredential(viewerProfileId);
        return credential === null
            ? { configured: false, viewerProfileId }
            : {
                  configured: true,
                  viewerProfileId,
                  visibility: credential.visibility,
                  account: credential.account,
              };
    }

    public async beginAuthorization(
        viewerProfileId: apid.ViewerProfileId,
        visibility: apid.MisskeyVisibility,
    ): Promise<apid.MisskeyAuthorizationStart> {
        if (!this.isVisibility(visibility)) throw new Error('Misskey.ioの公開範囲が不正です');
        this.removeExpiredAuthorizations();
        const sessionId = randomUUID();
        const expiresAt = Date.now() + MisskeyApiModel.AUTHORIZATION_TTL;
        this.pendingAuthorizations.set(sessionId, { viewerProfileId, visibility, expiresAt });
        const query = new URLSearchParams({
            name: 'NeoEPGStation',
            permission: 'read:account,write:notes',
        });
        return {
            sessionId,
            authorizationUrl: `https://${MisskeyApiModel.INSTANCE}/miauth/${sessionId}?${query.toString()}`,
            expiresAt,
        };
    }

    public async checkAuthorization(
        viewerProfileId: apid.ViewerProfileId,
        sessionId: string,
    ): Promise<apid.MisskeyAuthorizationCheck> {
        this.removeExpiredAuthorizations();
        const authorization = this.pendingAuthorizations.get(sessionId);
        if (authorization === undefined || authorization.viewerProfileId !== viewerProfileId) {
            throw new Error('Misskey.ioの認証セッションが見つかりません。連携を最初からやり直してください');
        }
        let response: MisskeyAuthorizationResponse;
        try {
            response = (
                await axios.post<MisskeyAuthorizationResponse>(
                    `${MisskeyApiModel.API_BASE}/miauth/${encodeURIComponent(sessionId)}/check`,
                    {},
                    { timeout: 20_000 },
                )
            ).data;
        } catch (error) {
            if (axios.isAxiosError(error) && (error.response?.status === 400 || error.response?.status === 404)) {
                return { completed: false };
            }
            throw this.apiError(error, 'Misskey.ioの認証状態を確認できませんでした');
        }
        if (response.ok !== true) return { completed: false };
        const token = response.token;
        const profile = response.user;
        if (
            typeof token !== 'string' ||
            token.length === 0 ||
            typeof profile?.id !== 'string' ||
            typeof profile.username !== 'string'
        ) {
            throw new Error('Misskey.ioから受け取った認証情報が不正です');
        }
        const account: apid.MisskeyAccountInfo = {
            name: profile.name?.trim() || profile.username,
            username: profile.username,
            userId: profile.id,
            instance: MisskeyApiModel.INSTANCE,
            iconUrl: profile.avatarUrl ?? undefined,
        };
        await this.writeCredential(viewerProfileId, {
            accessToken: token,
            visibility: authorization.visibility,
            account,
        });
        this.pendingAuthorizations.delete(sessionId);
        return {
            completed: true,
            status: {
                configured: true,
                viewerProfileId,
                visibility: authorization.visibility,
                account,
            },
        };
    }

    public async disconnect(viewerProfileId: apid.ViewerProfileId): Promise<void> {
        await this.viewerProfileApiModel.deleteCredential(viewerProfileId, MisskeyApiModel.PROVIDER);
    }

    public async getTimeline(viewerProfileId: apid.ViewerProfileId): Promise<apid.TwitterTimeline> {
        const notes = await this.request<MisskeyNote[]>(viewerProfileId, 'notes/timeline', { limit: 40 });
        return { tweets: notes.map(note => this.toTweet(note)), refreshedAt: Date.now() };
    }

    public async search(viewerProfileId: apid.ViewerProfileId, query: string): Promise<apid.TwitterTimeline> {
        const normalized = query.trim();
        if (normalized.length === 0 || normalized.length > 500) throw new Error('検索キーワードが不正です');
        const notes = await this.request<MisskeyNote[]>(viewerProfileId, 'notes/search', {
            query: normalized,
            limit: 40,
        });
        return { tweets: notes.map(note => this.toTweet(note)), refreshedAt: Date.now() };
    }

    public async post(viewerProfileId: apid.ViewerProfileId, text: string): Promise<void> {
        const normalized = text.trim();
        if (normalized.length === 0) throw new Error('投稿内容を入力してください');
        if (Array.from(normalized).length > 3000) throw new Error('投稿内容が3000文字を超えています');
        const credential = await this.requireCredential(viewerProfileId);
        await this.request(viewerProfileId, 'notes/create', {
            text: normalized,
            visibility: credential.visibility,
        });
    }

    private async request<T>(viewerProfileId: number, endpoint: string, payload: Record<string, unknown>): Promise<T> {
        const credential = await this.requireCredential(viewerProfileId);
        try {
            return (
                await axios.post<T>(
                    `${MisskeyApiModel.API_BASE}/${endpoint}`,
                    { ...payload, i: credential.accessToken },
                    { timeout: 20_000 },
                )
            ).data;
        } catch (error) {
            throw this.apiError(error, 'Misskey.io APIへの接続に失敗しました');
        }
    }

    private async requireCredential(viewerProfileId: number): Promise<StoredMisskeyCredential> {
        const credential = await this.readCredential(viewerProfileId);
        if (credential === null) throw new Error('Misskey.ioアカウントが連携されていません');
        return credential;
    }

    private async readCredential(viewerProfileId: number): Promise<StoredMisskeyCredential | null> {
        const value = await this.viewerProfileApiModel.getCredential(viewerProfileId, MisskeyApiModel.PROVIDER);
        if (value === null) return null;
        try {
            const credential = JSON.parse(value) as StoredMisskeyCredential;
            if (
                typeof credential.accessToken !== 'string' ||
                !this.isVisibility(credential.visibility) ||
                credential.account?.instance !== MisskeyApiModel.INSTANCE ||
                typeof credential.account?.username !== 'string' ||
                typeof credential.account?.userId !== 'string'
            ) {
                throw new Error('InvalidCredential');
            }
            return credential;
        } catch {
            throw new Error('保存済みMisskey.io資格情報が不正です。設定から再連携してください');
        }
    }

    private async writeCredential(viewerProfileId: number, credential: StoredMisskeyCredential): Promise<void> {
        await this.viewerProfileApiModel.setCredential(
            viewerProfileId,
            MisskeyApiModel.PROVIDER,
            JSON.stringify(credential),
        );
    }

    private toTweet(note: MisskeyNote): apid.TwitterTweet {
        const displayed = note.text === null && note.renote !== null && note.renote !== undefined ? note.renote : note;
        const user = displayed.user ?? {};
        const username = user.username || 'unknown';
        const host = user.host || MisskeyApiModel.INSTANCE;
        const createdAt = Date.parse(displayed.createdAt ?? '');
        const reactions = Object.values(displayed.reactions ?? {}).reduce((sum, count) => sum + count, 0);
        const id = displayed.id || note.id || `${username}-${Date.now().toString(10)}`;
        return {
            source: 'misskey',
            id,
            url: `https://${MisskeyApiModel.INSTANCE}/notes/${encodeURIComponent(id)}`,
            text: displayed.text ?? '',
            authorName: user.name?.trim() || username,
            authorScreenName: `${username}@${host}`,
            authorIconUrl: user.avatarUrl ?? undefined,
            createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
            imageUrls: (displayed.files ?? [])
                .filter(file => file.type?.startsWith('image/') === true)
                .map(file => file.thumbnailUrl || file.url || '')
                .filter(url => url.length > 0),
            replyCount: displayed.repliesCount ?? 0,
            retweetCount: displayed.renoteCount ?? 0,
            likeCount: reactions,
            retweeted: false,
            liked: typeof displayed.myReaction === 'string',
        };
    }

    private isVisibility(value: string): value is apid.MisskeyVisibility {
        return value === 'public' || value === 'home' || value === 'followers';
    }

    private removeExpiredAuthorizations(): void {
        const now = Date.now();
        for (const [sessionId, authorization] of this.pendingAuthorizations) {
            if (authorization.expiresAt <= now) this.pendingAuthorizations.delete(sessionId);
        }
    }

    private apiError(error: unknown, fallback: string): Error {
        if (!(error instanceof AxiosError) && !axios.isAxiosError(error)) {
            return new Error(`${fallback}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const detail = error.response?.data as
            { error?: { message?: string; code?: string }; message?: string } | undefined;
        const message = detail?.error?.message || detail?.error?.code || detail?.message;
        return new Error(message === undefined ? fallback : `${fallback}: ${message}`);
    }
}
