import HLSUtil from '@/util/HLSUtil';
import Util from '@/util/Util';
import Hls from 'hls.js';
import Mpegts from 'mpegts.js';
import LiveJikkyoCommentCore from './comment/LiveJikkyoCommentCore';
import DPlayerDanmakuUtil from './DPlayerDanmakuUtil';

interface DPlayerInstance {
    video: HTMLVideoElement;
    plugins: any;
    danmaku?: {
        draw(comment: { text: string; color: string; type: string; size: string }): void;
        resize?: () => void;
    };
    on(name: string, callback: (info?: any) => void): void;
    destroy(): void;
}

declare global {
    interface Window {
        Hls?: typeof Hls;
        mpegts?: typeof Mpegts;
    }
}

export interface LiveMpegTsPlayerState {
    isLoading: boolean;
    isBuffering: boolean;
    loadingText: string;
}

export interface LiveMpegTsPlayerCoreOption {
    container: HTMLElement;
    channelId: number;
    src: string;
    lowLatency: boolean;
    onStateChange?: (state: LiveMpegTsPlayerState) => void;
    onError?: (err: any) => void;
    onWarn?: (err: any) => void;
}

export default class LiveMpegTsPlayerCore {
    private static readonly DANMAKU_FONT_SIZE = 34;

    private container: HTMLElement;
    private channelId: number;
    private src: string;
    private lowLatency: boolean;
    private player: DPlayerInstance | null = null;
    private jikkyoCommentCore: LiveJikkyoCommentCore | null = null;
    private isDestroyed: boolean = false;
    private isRestarting: boolean = false;
    private restartTimer: number | null = null;
    private onStateChange?: (state: LiveMpegTsPlayerState) => void;
    private onError?: (err: any) => void;
    private onWarn?: (err: any) => void;
    private state: LiveMpegTsPlayerState = {
        isLoading: true,
        isBuffering: false,
        loadingText: 'プレイヤーを初期化中...',
    };

    constructor(option: LiveMpegTsPlayerCoreOption) {
        this.container = option.container;
        this.channelId = option.channelId;
        this.src = option.src;
        this.lowLatency = option.lowLatency;
        this.onStateChange = option.onStateChange;
        this.onError = option.onError;
        this.onWarn = option.onWarn;
        this.emitState();
    }

    public async init(): Promise<void> {
        this.isDestroyed = false;
        await this.initPlayer();
    }

    public setSource(src: string): void {
        if (this.src === src) {
            return;
        }

        this.src = src;
        this.restart('視聴ストリームを切り替えています...');
    }

    public setChannelId(channelId: number): void {
        if (this.channelId === channelId) {
            return;
        }

        this.channelId = channelId;
        this.restart('放送局を切り替えています...');
    }

    public setLowLatency(lowLatency: boolean): void {
        if (this.lowLatency === lowLatency) {
            return;
        }

        this.lowLatency = lowLatency;
        this.restart('低遅延設定を切り替えています...');
    }

    public restart(message: string = 'プレイヤーを再起動しています...'): void {
        if (this.isDestroyed === true || this.isRestarting === true) {
            return;
        }

        this.isRestarting = true;
        this.setState({
            isLoading: true,
            isBuffering: false,
            loadingText: message,
        });
        this.destroyPlayer();

        this.restartTimer = window.setTimeout(() => {
            this.isRestarting = false;
            this.initPlayer().catch(err => {
                this.handleInitError(err);
            });
        }, 500);
    }

    public getVideoElement(): HTMLVideoElement | null {
        return this.player?.video ?? null;
    }

    public destroy(): void {
        this.isDestroyed = true;

        if (this.restartTimer !== null) {
            clearTimeout(this.restartTimer);
        }

        this.destroyPlayer();
    }

    private async initPlayer(): Promise<void> {
        if (this.isDestroyed === true) {
            return;
        }

        this.setState({
            isLoading: true,
            isBuffering: false,
            loadingText: 'ストリームに接続中...',
        });

        const DPlayer = (await import(/* webpackChunkName: "dplayer" */ 'dplayer')).default as any;
        window.mpegts = Mpegts;
        window.Hls = Hls;

        const aribb24Option = HLSUtil.getAribb24BaseOption();
        const options: any = {
            container: this.container,
            theme: '#E64F97',
            lang: 'ja-jp',
            live: true,
            liveSyncMinBufferSize: this.lowLatency === true ? 1.5 : 4.0,
            syncWhenPlayingLive: this.lowLatency,
            autoplay: true,
            airplay: false,
            hotkey: false,
            screenshot: true,
            crossOrigin: 'anonymous',
            volume: 1.0,
            playbackSpeed: [0.25, 0.5, 0.75, 1, 1.1, 1.25, 1.5, 1.75, 2],
            video: {
                url: this.src,
                type: 'mpegts',
            },
            subtitle: {
                type: 'aribb24',
            },
            pluginOptions: {
                mpegts: {
                    config: {
                        enableWorker: true,
                        liveBufferLatencyChasing: this.lowLatency,
                        liveBufferLatencyMinRemain: this.lowLatency === true ? 1.0 : 3.0,
                        liveBufferLatencyMaxLatency: this.lowLatency === true ? 2.0 : 8.0,
                    },
                },
                aribb24: aribb24Option,
            },
            danmaku: {
                user: 'EPGStation',
                speedRate: 1,
                fontSize: LiveMpegTsPlayerCore.DANMAKU_FONT_SIZE,
            },
            apiBackend: {
                read: (readOption: any) => readOption.success([]),
                send: (sendOption: any) => sendOption.error('コメント投稿にはまだ対応していません。'),
            },
        };

        this.player = new DPlayer(options) as DPlayerInstance;
        DPlayerDanmakuUtil.stabilizeResize(this.player, this.container);
        this.bindPlayerEvents();
        this.initJikkyoCommentCore();
    }

    private handleInitError(err: any): void {
        this.onError?.(err);
        this.setState({
            isLoading: true,
            isBuffering: false,
            loadingText: 'プレイヤーの初期化に失敗しました。',
        });
    }

    private bindPlayerEvents(): void {
        if (this.player === null) {
            return;
        }

        this.player.on('waiting', () => {
            this.setState({
                isLoading: this.state.isLoading,
                isBuffering: true,
                loadingText: 'バッファリング中...',
            });
        });

        this.player.on('playing', () => {
            if (this.state.isLoading === false) {
                this.setState({
                    isLoading: false,
                    isBuffering: false,
                    loadingText: this.state.loadingText,
                });
            }
            this.recoverPlayback();
        });

        this.player.on('error', () => {
            this.restart('再生エラーを検知しました。プレイヤーを再起動しています...');
        });

        this.player.on('canplay', () => {
            this.onCanPlay().catch(err => {
                this.handleInitError(err);
            });
        });

        this.bindMpegtsEvents();
        this.ensureCanPlayFallback();
    }

    private bindMpegtsEvents(): void {
        if (this.player === null) {
            return;
        }

        const mpegtsPlayer = (this.player.plugins as any).mpegts;
        if (mpegtsPlayer === undefined || typeof mpegtsPlayer.on !== 'function') {
            return;
        }

        mpegtsPlayer.on((Mpegts.Events as any).ERROR, (errorType: string, detail: string) => {
            this.onError?.(`[WatchOnAirPlayer] mpegts.js error: ${errorType} ${detail}`);
            this.restart(`ストリームエラーを検知しました。(${errorType}) プレイヤーを再起動しています...`);
        });

        const mediaInfoEvent = (Mpegts.Events as any).MEDIA_INFO;
        if (mediaInfoEvent !== undefined) {
            mpegtsPlayer.on(mediaInfoEvent, async () => {
                await Util.sleep(250);
                if (this.state.isLoading === true) {
                    await this.onCanPlay();
                }
            });
        }
    }

    private async ensureCanPlayFallback(): Promise<void> {
        await Util.sleep(15000);
        if (this.isDestroyed === true || this.player === null || this.state.isLoading === false) {
            return;
        }

        this.restart('再生開始までに時間が掛かっています。プレイヤーを再起動しています...');
    }

    private async onCanPlay(): Promise<void> {
        if (this.player === null || this.state.isLoading === false) {
            return;
        }

        this.setState({
            isLoading: true,
            isBuffering: this.state.isBuffering,
            loadingText: '再生バッファを調整中...',
        });

        const video = this.player.video;
        video.playbackRate = 0;

        let bufferSeconds = this.getPlaybackBufferSeconds();
        while (this.isDestroyed === false && this.player !== null && bufferSeconds < 1.5) {
            await Util.sleep(100);
            bufferSeconds = this.getPlaybackBufferSeconds();
        }

        if (this.player === null) {
            return;
        }

        video.playbackRate = 1;
        this.setState({
            isLoading: false,
            isBuffering: false,
            loadingText: this.state.loadingText,
        });
        this.recoverPlayback();
    }

    private getPlaybackBufferSeconds(): number {
        if (this.player === null) {
            return 0;
        }

        const video = this.player.video;
        const currentTime = video.currentTime;
        for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= currentTime && currentTime <= video.buffered.end(i)) {
                return video.buffered.end(i) - currentTime;
            }
        }

        return 0;
    }

    private recoverPlayback(): void {
        if (this.player === null || this.player.video.paused === false) {
            return;
        }

        this.player.video.play().catch(err => {
            this.onWarn?.(err);
        });
    }

    private initJikkyoCommentCore(): void {
        if (this.player === null) {
            return;
        }

        this.jikkyoCommentCore = new LiveJikkyoCommentCore({
            channelId: this.channelId,
            video: this.player.video,
            onComment: comment => {
                this.player?.danmaku?.draw({
                    text: comment.text,
                    color: comment.color,
                    type: comment.position,
                    size: comment.size,
                });
                DPlayerDanmakuUtil.setFontSize(this.container, LiveMpegTsPlayerCore.DANMAKU_FONT_SIZE);
            },
            onError: err => {
                this.onWarn?.(err);
            },
        });
        this.jikkyoCommentCore.start().catch(err => {
            this.onWarn?.(err);
        });
    }

    private destroyPlayer(): void {
        this.jikkyoCommentCore?.destroy();
        this.jikkyoCommentCore = null;

        if (this.player === null) {
            return;
        }

        try {
            this.player.destroy();
        } catch (err) {
            this.onError?.(err);
        }
        this.player = null;
    }

    private setState(state: LiveMpegTsPlayerState): void {
        this.state = state;
        this.emitState();
    }

    private emitState(): void {
        this.onStateChange?.({ ...this.state });
    }
}
