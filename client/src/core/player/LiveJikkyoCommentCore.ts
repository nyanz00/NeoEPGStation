import type { ChannelJikkyoInfo } from '../../../../api';
import { apiClient } from '../api/client';
import { type JikkyoComment, parseJikkyoCommentCommand } from './jikkyoComment';

interface WatchSessionInfo {
    commentSessionUrl: string;
    threadId: string;
    threadKey: string | null;
}

export interface LiveJikkyoCommentCoreOption {
    channelId: number;
    video: HTMLVideoElement;
    onComment: (comment: JikkyoComment) => void;
    onPostAvailabilityChange?: (available: boolean, detail?: string, target?: 'nicolive' | 'nx-jikkyo' | null) => void;
    onError?: (error: unknown) => void;
}

export class LiveJikkyoCommentCore {
    private readonly option: LiveJikkyoCommentCoreOption;
    private watchSession: WebSocket | null = null;
    private commentSession: WebSocket | null = null;
    private keepSeatTimer: number | null = null;
    private reconnectTimer: number | null = null;
    private pendingCommentTimers: number[] = [];
    private destroyed = false;
    private reconnecting = false;
    private initialCommentsReceived = false;
    private currentInfo: ChannelJikkyoInfo | null = null;
    private vposBaseTime = 0;
    private posting = false;
    private requestController: AbortController | null = null;

    constructor(option: LiveJikkyoCommentCoreOption) {
        this.option = option;
    }

    public async start(): Promise<void> {
        this.destroyed = false;
        this.requestController?.abort();
        const controller = new AbortController();
        this.requestController = controller;
        try {
            this.currentInfo = (
                await apiClient.get<ChannelJikkyoInfo>(`/channels/${this.option.channelId.toString(10)}/jikkyo`, {
                    signal: controller.signal,
                    timeout: 8_000,
                })
            ).data;
            if (this.destroyed || controller.signal.aborted) return;
            this.option.onPostAvailabilityChange?.(this.currentInfo.canPost === true, this.currentInfo.nicoliveWatchSessionError ?? undefined, this.currentInfo.postingTarget);
            if (this.currentInfo.watchSessionUrl === null || this.currentInfo.commentSessionUrl === null) return;
            this.connectWatchSession(this.currentInfo);
        } catch (error) {
            if (controller.signal.aborted || this.destroyed) return;
            this.option.onError?.(error);
            this.scheduleReconnect();
        } finally {
            if (this.requestController === controller) this.requestController = null;
        }
    }

    public destroy(): void {
        this.destroyed = true;
        this.requestController?.abort();
        this.requestController = null;
        this.clearConnections();
        this.currentInfo = null;
        this.option.onPostAvailabilityChange?.(false);
    }

    private connectWatchSession(info: ChannelJikkyoInfo): void {
        if (info.watchSessionUrl === null || info.commentSessionUrl === null || this.destroyed) return;
        const session = new WebSocket(info.watchSessionUrl);
        this.watchSession = session;
        session.addEventListener('open', () => {
            session.send(JSON.stringify({ type: 'startWatching', data: { reconnect: false } }));
        });
        session.addEventListener('message', event => this.handleWatchMessage(event, info));
        session.addEventListener('close', () => this.scheduleReconnect());
        session.addEventListener('error', () => this.scheduleReconnect());
    }

    private handleWatchMessage(event: MessageEvent, info: ChannelJikkyoInfo): void {
        if (this.watchSession === null || typeof event.data !== 'string') return;
        let message: any;
        try {
            message = JSON.parse(event.data);
        } catch {
            return;
        }
        if (message.type === 'seat' && this.keepSeatTimer === null) {
            this.keepSeatTimer = window.setInterval(
                () => {
                    if (this.watchSession?.readyState === WebSocket.OPEN) this.watchSession.send(JSON.stringify({ type: 'keepSeat' }));
                },
                Number(message.data.keepIntervalSec) * 1000,
            );
        } else if (message.type === 'ping') {
            this.watchSession.send(JSON.stringify({ type: 'pong' }));
        } else if (message.type === 'room') {
            this.vposBaseTime = Date.parse(message.data.vposBaseTime ?? '') || Date.now();
            this.connectCommentSession({
                commentSessionUrl: message.data.messageServer?.uri ?? info.commentSessionUrl,
                threadId: message.data.threadId ?? '',
                threadKey: message.data.yourPostKey ?? null,
            });
        } else if (message.type === 'messageServer' && info.commentSessionUrl !== null) {
            this.vposBaseTime = Date.parse(message.data.vposBaseTime ?? '') || Date.now();
            this.connectCommentSession({ commentSessionUrl: info.commentSessionUrl, threadId: '', threadKey: null });
        } else if (message.type === 'disconnect' || message.type === 'reconnect' || message.type === 'error') {
            this.scheduleReconnect();
        }
    }

    public async sendComment(text: string, color: string, position: 'top' | 'right' | 'bottom', size: 'big' | 'medium' | 'small'): Promise<void> {
        const normalized = text.trim();
        if (normalized.length === 0) throw new Error('コメントを入力してください');
        if (normalized.length > 75) throw new Error('コメントは75文字以内で入力してください');
        if (this.posting) throw new Error('コメントを送信中です');
        if (this.currentInfo?.canPost !== true) {
            throw new Error('ニコニコ実況へ投稿できる接続がありません');
        }
        if (this.currentInfo.postingTarget === 'nicolive') {
            this.posting = true;
            try {
                await apiClient.post(
                    '/niconico/comment',
                    {
                        channelId: this.option.channelId,
                        text: normalized,
                        color,
                        position,
                        size,
                    },
                    { timeout: 20_000 },
                );
            } finally {
                this.posting = false;
            }
            return;
        }
        const session = this.watchSession;
        if (session === null || session.readyState !== WebSocket.OPEN) {
            throw new Error('NX-Jikkyoへ投稿できる接続がありません');
        }
        const positionCommand = { top: 'ue', right: 'naka', bottom: 'shita' } as const;
        this.posting = true;
        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => finish(new Error('コメント送信がタイムアウトしました')), 10_000);
            const receive = (event: MessageEvent): void => {
                if (typeof event.data !== 'string') return;
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'postCommentResult') finish();
                    else if (message.type === 'error' && ['COMMENT_POST_NOT_ALLOWED', 'INVALID_MESSAGE'].includes(message.data?.code)) {
                        finish(new Error(message.data.code === 'INVALID_MESSAGE' ? 'コメント内容が無効です' : 'コメント投稿が許可されていません'));
                    }
                } catch {
                    return;
                }
            };
            const finish = (error?: Error): void => {
                window.clearTimeout(timeout);
                session.removeEventListener('message', receive);
                this.posting = false;
                if (error === undefined) resolve();
                else reject(error);
            };
            session.addEventListener('message', receive);
            session.send(
                JSON.stringify({
                    type: 'postComment',
                    data: {
                        text: normalized,
                        color,
                        position: positionCommand[position],
                        size,
                        vpos: Math.max(0, Math.round((Date.now() - this.vposBaseTime) / 10)),
                        isAnonymous: true,
                    },
                }),
            );
        });
    }

    private connectCommentSession(info: WatchSessionInfo): void {
        if (this.commentSession !== null || this.destroyed) return;
        this.initialCommentsReceived = false;
        const session = new WebSocket(info.commentSessionUrl);
        this.commentSession = session;
        session.addEventListener('open', () => {
            session.send(
                JSON.stringify([
                    { ping: { content: 'rs:0' } },
                    { ping: { content: 'ps:0' } },
                    { thread: { version: '20061206', thread: info.threadId, threadkey: info.threadKey, user_id: '', res_from: -100 } },
                    { ping: { content: 'pf:0' } },
                    { ping: { content: 'rf:0' } },
                ]),
            );
        });
        session.addEventListener('message', event => this.handleCommentMessage(event));
        session.addEventListener('close', () => this.scheduleReconnect());
        session.addEventListener('error', () => this.scheduleReconnect());
    }

    private handleCommentMessage(event: MessageEvent): void {
        if (typeof event.data !== 'string') return;
        let message: any;
        try {
            message = JSON.parse(event.data);
        } catch {
            return;
        }
        if (message.ping?.content === 'rf:0') {
            this.initialCommentsReceived = true;
            return;
        }
        if (!this.initialCommentsReceived || typeof message.chat?.content !== 'string' || message.chat.content.length === 0) return;
        const chat = message.chat;
        if (/^\/[a-z][a-z0-9_-]*(?:\s|$)/i.test(chat.content) && `${chat.premium ?? ''}` === '3') return;

        const command = parseJikkyoCommentCommand(chat.mail);
        const comment: JikkyoComment = {
            id: Number(chat.no ?? 0),
            text: chat.content,
            color: command.color,
            position: command.position,
            size: command.size,
            userId: String(chat.user_id ?? ''),
            postedAt: Number(chat.date ?? 0) * 1000,
            vpos: typeof chat.vpos === 'number' ? chat.vpos : null,
        };
        const timer = window.setTimeout(() => {
            this.pendingCommentTimers = this.pendingCommentTimers.filter(id => id !== timer);
            if (!this.destroyed && !this.option.video.paused) this.option.onComment(comment);
        }, this.getPlaybackDelay() * 1000);
        this.pendingCommentTimers.push(timer);
    }

    private getPlaybackDelay(): number {
        const video = this.option.video;
        let bufferedEnd = video.currentTime;
        for (let index = 0; index < video.buffered.length; index++) {
            if (video.buffered.start(index) <= video.currentTime && video.currentTime <= video.buffered.end(index)) {
                bufferedEnd = video.buffered.end(index);
                break;
            }
        }
        return Math.max(bufferedEnd - video.currentTime, 0);
    }

    private scheduleReconnect(): void {
        if (this.destroyed || this.reconnecting) return;
        this.reconnecting = true;
        this.clearConnections();
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnecting = false;
            void this.start();
        }, 3000);
    }

    private clearConnections(): void {
        if (this.keepSeatTimer !== null) window.clearInterval(this.keepSeatTimer);
        if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
        this.keepSeatTimer = null;
        this.reconnectTimer = null;
        this.pendingCommentTimers.forEach(timer => window.clearTimeout(timer));
        this.pendingCommentTimers = [];
        this.option.onPostAvailabilityChange?.(false);
        const watchSession = this.watchSession;
        const commentSession = this.commentSession;
        this.watchSession = null;
        this.commentSession = null;
        watchSession?.close();
        commentSession?.close();
    }
}
