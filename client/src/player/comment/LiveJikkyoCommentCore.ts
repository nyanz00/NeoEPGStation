import Util from '@/util/Util';
import { JikkyoComment, parseJikkyoCommentCommand } from './JikkyoComment';

interface ChannelJikkyoInfo {
    jikkyoId: string | null;
    watchSessionUrl: string | null;
    commentSessionUrl: string | null;
}

interface WatchSessionInfo {
    commentSessionUrl: string;
    threadId: string;
    threadKey: string | null;
}

export interface LiveJikkyoCommentState {
    status: 'connecting' | 'connected' | 'unsupported' | 'disconnected' | 'error';
    jikkyoId: string | null;
    message?: string;
}

export interface LiveJikkyoCommentCoreOption {
    channelId: number;
    video: HTMLVideoElement;
    onComment: (comment: JikkyoComment) => void;
    onStateChange?: (state: LiveJikkyoCommentState) => void;
    onError?: (err: any) => void;
}

export default class LiveJikkyoCommentCore {
    private readonly option: LiveJikkyoCommentCoreOption;
    private watchSession: WebSocket | null = null;
    private commentSession: WebSocket | null = null;
    private keepSeatTimer: number | null = null;
    private reconnectTimer: number | null = null;
    private pendingCommentTimers: number[] = [];
    private isDestroyed: boolean = false;
    private isReconnecting: boolean = false;
    private initialCommentsReceived: boolean = false;
    private currentInfo: ChannelJikkyoInfo | null = null;

    constructor(option: LiveJikkyoCommentCoreOption) {
        this.option = option;
    }

    public async start(): Promise<void> {
        this.isDestroyed = false;
        this.emitState({ status: 'connecting', jikkyoId: null });

        try {
            const response = await fetch(`${window.location.origin}${Util.getSubDirectory()}/api/channels/${this.option.channelId.toString(10)}/jikkyo`);
            if (response.ok === false) {
                throw new Error(`JikkyoInfoRequestFailed: ${response.status.toString(10)}`);
            }

            this.currentInfo = (await response.json()) as ChannelJikkyoInfo;
            if (this.currentInfo.watchSessionUrl === null || this.currentInfo.commentSessionUrl === null) {
                this.emitState({ status: 'unsupported', jikkyoId: null, message: 'この放送局はNX-Jikkyoに対応していません。' });

                return;
            }

            this.connectWatchSession(this.currentInfo);
        } catch (err) {
            this.handleError(err);
            this.scheduleReconnect();
        }
    }

    public destroy(): void {
        this.isDestroyed = true;
        this.clearConnections();
        this.currentInfo = null;
    }

    private connectWatchSession(info: ChannelJikkyoInfo): void {
        if (info.watchSessionUrl === null || info.commentSessionUrl === null || this.isDestroyed === true) {
            return;
        }

        const watchSession = new WebSocket(info.watchSessionUrl);
        this.watchSession = watchSession;
        watchSession.addEventListener('open', () => {
            watchSession.send(JSON.stringify({ type: 'startWatching', data: { reconnect: false } }));
        });
        watchSession.addEventListener('message', event => {
            this.handleWatchMessage(event, info);
        });
        watchSession.addEventListener('close', event => {
            this.handleConnectionClosed(`NX-Jikkyo watch session closed: ${event.code.toString(10)}`);
        });
        watchSession.addEventListener('error', () => {
            this.handleConnectionClosed('NX-Jikkyo watch session error');
        });
    }

    private handleWatchMessage(event: MessageEvent, info: ChannelJikkyoInfo): void {
        if (this.watchSession === null || typeof event.data !== 'string') {
            return;
        }

        const message = JSON.parse(event.data);
        if (message.type === 'seat' && this.keepSeatTimer === null) {
            this.keepSeatTimer = window.setInterval(() => {
                if (this.watchSession?.readyState === WebSocket.OPEN) {
                    this.watchSession.send(JSON.stringify({ type: 'keepSeat' }));
                }
            }, Number(message.data.keepIntervalSec) * 1000);
        } else if (message.type === 'ping') {
            this.watchSession.send(JSON.stringify({ type: 'pong' }));
        } else if (message.type === 'room') {
            this.connectCommentSession({
                commentSessionUrl: message.data.messageServer?.uri ?? info.commentSessionUrl,
                threadId: message.data.threadId ?? '',
                threadKey: message.data.yourPostKey ?? null,
            });
        } else if (message.type === 'messageServer') {
            if (info.commentSessionUrl === null) {
                return;
            }
            this.connectCommentSession({
                commentSessionUrl: info.commentSessionUrl,
                threadId: '',
                threadKey: null,
            });
        } else if (message.type === 'disconnect' || message.type === 'reconnect' || message.type === 'error') {
            this.handleConnectionClosed(`NX-Jikkyo watch message: ${message.type}`);
        }
    }

    private connectCommentSession(info: WatchSessionInfo): void {
        if (this.commentSession !== null || this.isDestroyed === true) {
            return;
        }

        this.initialCommentsReceived = false;
        const commentSession = new WebSocket(info.commentSessionUrl);
        this.commentSession = commentSession;
        commentSession.addEventListener('open', () => {
            commentSession.send(
                JSON.stringify([
                    { ping: { content: 'rs:0' } },
                    { ping: { content: 'ps:0' } },
                    {
                        thread: {
                            version: '20061206',
                            thread: info.threadId,
                            threadkey: info.threadKey,
                            user_id: '',
                            res_from: -100,
                        },
                    },
                    { ping: { content: 'pf:0' } },
                    { ping: { content: 'rf:0' } },
                ]),
            );
        });
        commentSession.addEventListener('message', event => {
            this.handleCommentMessage(event);
        });
        commentSession.addEventListener('close', event => {
            this.handleConnectionClosed(`NX-Jikkyo comment session closed: ${event.code.toString(10)}`);
        });
        commentSession.addEventListener('error', () => {
            this.handleConnectionClosed('NX-Jikkyo comment session error');
        });
        this.emitState({ status: 'connected', jikkyoId: this.currentInfo?.jikkyoId ?? null });
    }

    private handleCommentMessage(event: MessageEvent): void {
        if (typeof event.data !== 'string') {
            return;
        }

        const message = JSON.parse(event.data);
        if (message.ping?.content === 'rf:0') {
            this.initialCommentsReceived = true;

            return;
        }
        if (this.initialCommentsReceived === false || typeof message.chat?.content !== 'string' || message.chat.content.length === 0) {
            return;
        }

        const chat = message.chat;
        if (/^\/[a-z][a-z0-9_-]*(?:\s|$)/i.test(chat.content) === true && `${chat.premium ?? ''}` === '3') {
            return;
        }

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
            if (this.isDestroyed === false && this.option.video.paused === false) {
                this.option.onComment(comment);
            }
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

    private handleConnectionClosed(message: string): void {
        if (this.isDestroyed === true) {
            return;
        }

        this.emitState({ status: 'disconnected', jikkyoId: this.currentInfo?.jikkyoId ?? null, message });
        this.scheduleReconnect();
    }

    private scheduleReconnect(): void {
        if (this.isDestroyed === true || this.isReconnecting === true) {
            return;
        }

        this.isReconnecting = true;
        this.clearConnections();
        this.reconnectTimer = window.setTimeout(() => {
            this.isReconnecting = false;
            this.start().catch(err => this.handleError(err));
        }, 3000);
    }

    private clearConnections(): void {
        if (this.keepSeatTimer !== null) {
            window.clearInterval(this.keepSeatTimer);
            this.keepSeatTimer = null;
        }
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        for (const timer of this.pendingCommentTimers) {
            window.clearTimeout(timer);
        }
        this.pendingCommentTimers = [];

        const watchSession = this.watchSession;
        const commentSession = this.commentSession;
        this.watchSession = null;
        this.commentSession = null;
        watchSession?.close();
        commentSession?.close();
    }

    private handleError(err: any): void {
        this.option.onError?.(err);
        this.emitState({
            status: 'error',
            jikkyoId: this.currentInfo?.jikkyoId ?? null,
            message: err instanceof Error ? err.message : String(err),
        });
    }

    private emitState(state: LiveJikkyoCommentState): void {
        this.option.onStateChange?.(state);
    }
}
