import HLSUtil from '@/util/HLSUtil';
import Hls from 'hls.js';
import Mpegts from 'mpegts.js';
import RecordedJikkyoCommentCore from './comment/RecordedJikkyoCommentCore';
import DPlayerDanmakuUtil from './DPlayerDanmakuUtil';

type RecordedStreamingPlayerType = 'hls' | 'mpegts' | 'normal';

interface DPlayerInstance {
    video: HTMLVideoElement;
    plugins: any;
    danmaku?: {
        draw(comment: { text: string; color: string; type: string; size: string }): void;
        clear(): void;
        resize?: () => void;
    };
    on(name: string, callback: (info?: any) => void): void;
    switchVideo(video: { url: string; type?: string }, subtitle?: any): void;
    destroy(): void;
}

declare global {
    interface Window {
        Hls?: typeof Hls;
        mpegts?: typeof Mpegts;
    }
}

export interface RecordedStreamingPlayerState {
    isLoading: boolean;
    isBuffering: boolean;
    loadingText: string;
}

export interface RecordedStreamingPlayerCoreOption {
    container: HTMLElement;
    src: string;
    type: RecordedStreamingPlayerType;
    enableAribSubtitle: boolean;
    duration: number;
    jikkyoCommentsUrl?: string;
    enableDanmaku?: boolean;
    onStateChange?: (state: RecordedStreamingPlayerState) => void;
    onError?: (err: any) => void;
}

export default class RecordedStreamingPlayerCore {
    private static readonly DANMAKU_FONT_SIZE = 34;

    private container: HTMLElement;
    private src: string;
    private type: RecordedStreamingPlayerType;
    private enableAribSubtitle: boolean;
    private duration: number;
    private jikkyoCommentsUrl?: string;
    private enableDanmaku: boolean;
    private player: DPlayerInstance | null = null;
    private jikkyoCommentCore: RecordedJikkyoCommentCore | null = null;
    private durationFixTimer: number | null = null;
    private durationMutationObserver: MutationObserver | null = null;
    private skipOverlay: HTMLElement | null = null;
    private playPauseButtonIcon: HTMLElement | null = null;
    private skipOverlayHideTimer: number | null = null;
    private keyDownListener: ((event: KeyboardEvent) => void) | null = null;
    private showSkipOverlayListener: (() => void) | null = null;
    private hideSkipOverlayListener: (() => void) | null = null;
    private isApplyingDurationDisplay: boolean = false;
    private isDestroyed: boolean = false;
    private onStateChange?: (state: RecordedStreamingPlayerState) => void;
    private onError?: (err: any) => void;
    private state: RecordedStreamingPlayerState = {
        isLoading: true,
        isBuffering: false,
        loadingText: 'プレイヤーを初期化中...',
    };

    constructor(option: RecordedStreamingPlayerCoreOption) {
        this.container = option.container;
        this.src = option.src;
        this.type = option.type;
        this.enableAribSubtitle = option.enableAribSubtitle;
        this.duration = option.duration;
        this.jikkyoCommentsUrl = option.jikkyoCommentsUrl;
        this.enableDanmaku = option.enableDanmaku === true;
        this.onStateChange = option.onStateChange;
        this.onError = option.onError;
        this.emitState();
    }

    public async init(): Promise<void> {
        this.isDestroyed = false;
        await this.initPlayer();
    }

    public setSource(src: string, type: RecordedStreamingPlayerType, enableAribSubtitle: boolean, duration: number, jikkyoCommentsUrl?: string): void {
        if (
            this.src === src &&
            this.type === type &&
            this.enableAribSubtitle === enableAribSubtitle &&
            this.duration === duration &&
            this.jikkyoCommentsUrl === jikkyoCommentsUrl
        ) {
            return;
        }

        this.src = src;
        this.type = type;
        this.enableAribSubtitle = enableAribSubtitle;
        this.duration = duration;
        this.jikkyoCommentsUrl = jikkyoCommentsUrl;

        if (this.player === null) {
            this.initPlayer().catch(err => {
                this.handleInitError(err);
            });
            return;
        }

        this.setState({
            isLoading: true,
            isBuffering: false,
            loadingText: 'ストリームを切り替えています...',
        });
        this.player.switchVideo(this.createVideoOption(), this.createSubtitleOption());
        this.player.video.load();
        this.player.video.play().catch(err => {
            this.onError?.(err);
        });
        this.restartJikkyoCommentCore();
        this.bindDurationMutationObserver();
        this.startDurationFixTimer();
    }

    public getVideoElement(): HTMLVideoElement | null {
        return this.player?.video ?? null;
    }

    public drawDanmaku(comment: { text: string; color: string; position: string; size: string }): void {
        this.player?.danmaku?.draw({
            text: comment.text,
            color: comment.color,
            type: comment.position,
            size: comment.size,
        });
        DPlayerDanmakuUtil.setFontSize(this.container, RecordedStreamingPlayerCore.DANMAKU_FONT_SIZE);
    }

    public clearDanmaku(): void {
        this.player?.danmaku?.clear();
    }

    public destroy(): void {
        this.isDestroyed = true;
        this.clearDurationFixTimer();
        this.clearDurationMutationObserver();
        this.clearSkipControls();
        this.destroyJikkyoCommentCore();

        if (this.player !== null) {
            this.player.destroy();
            this.player = null;
        }
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
        window.Hls = Hls;
        window.mpegts = Mpegts;

        const options: any = {
            container: this.container,
            theme: '#E64F97',
            lang: 'ja-jp',
            live: false,
            liveSyncMinBufferSize: undefined,
            syncWhenPlayingLive: false,
            autoplay: true,
            airplay: false,
            hotkey: false,
            screenshot: true,
            crossOrigin: 'anonymous',
            volume: 1.0,
            playbackSpeed: [0.25, 0.5, 0.75, 1, 1.1, 1.25, 1.5, 1.75, 2],
            video: this.createVideoOption(),
        };

        if (typeof this.jikkyoCommentsUrl !== 'undefined' || this.enableDanmaku === true) {
            options.danmaku = {
                user: 'EPGStation',
                speedRate: 1,
                fontSize: RecordedStreamingPlayerCore.DANMAKU_FONT_SIZE,
            };
            options.apiBackend = {
                read: (readOption: any) => readOption.success([]),
                send: (sendOption: any) => sendOption.error('コメント投稿にはまだ対応していません。'),
            };
        }

        const subtitle = this.createSubtitleOption();
        options.pluginOptions = {
            hls: {
                ...Hls.DefaultConfig,
                enableWorker: true,
                lowLatencyMode: false,
                startFragPrefetch: true,
                maxBufferLength: 60,
                maxMaxBufferLength: 120,
                backBufferLength: 60,
            },
            mpegts: {
                config: {
                    enableWorker: true,
                    isLive: false,
                    liveBufferLatencyChasing: false,
                    liveBufferLatencyMinRemain: 3.0,
                    liveBufferLatencyMaxLatency: 8.0,
                },
            },
            aribb24: HLSUtil.getAribb24BaseOption(),
        };

        if (subtitle !== undefined) {
            options.subtitle = subtitle;
        }

        this.player = new DPlayer(options) as DPlayerInstance;
        DPlayerDanmakuUtil.stabilizeResize(this.player, this.container);
        this.bindPlayerEvents();
        this.bindMpegtsEvents();
        this.bindDurationMutationObserver();
        this.startDurationFixTimer();
        this.bindSkipControls();
        this.initJikkyoCommentCore();
    }

    private createVideoOption(): { url: string; type?: string } {
        if (this.type === 'hls') {
            return {
                url: this.src,
                type: 'hls',
            };
        }
        if (this.type === 'mpegts') {
            return {
                url: this.src,
                type: 'mpegts',
            };
        }

        return {
            url: this.src,
        };
    }

    private createSubtitleOption(): { type: string } | undefined {
        if (this.enableAribSubtitle === false) {
            return undefined;
        }

        return {
            type: 'aribb24',
        };
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
            this.setState({
                isLoading: false,
                isBuffering: false,
                loadingText: this.state.loadingText,
            });
            this.updatePlayPauseIcon();
        });

        this.player.on('pause', () => {
            this.updatePlayPauseIcon();
        });

        this.player.on('canplay', () => {
            this.setState({
                isLoading: false,
                isBuffering: false,
                loadingText: this.state.loadingText,
            });
            this.applyFixedDurationDisplay();
            this.updatePlayPauseIcon();
        });

        this.player.on('timeupdate', () => {
            this.applyFixedDurationDisplay();
        });

        this.player.on('error', err => {
            this.onError?.(err);
            this.setState({
                isLoading: true,
                isBuffering: false,
                loadingText: '再生エラーを検知しました。',
            });
        });
    }

    private startDurationFixTimer(): void {
        this.clearDurationFixTimer();

        if (this.duration <= 0) {
            return;
        }

        this.durationFixTimer = window.setInterval(() => {
            this.applyFixedDurationDisplay();
        }, 1000);
        this.applyFixedDurationDisplay();
    }

    private clearDurationFixTimer(): void {
        if (this.durationFixTimer === null) {
            return;
        }

        window.clearInterval(this.durationFixTimer);
        this.durationFixTimer = null;
    }

    private bindDurationMutationObserver(): void {
        this.clearDurationMutationObserver();

        if (this.duration <= 0) {
            return;
        }

        this.durationMutationObserver = new MutationObserver(() => {
            if (this.isApplyingDurationDisplay === true) {
                return;
            }

            this.applyFixedDurationDisplay();
        });

        window.requestAnimationFrame(() => {
            const durationElements = this.container.querySelectorAll<HTMLElement>('.dplayer-dtime');
            durationElements.forEach(element => {
                this.durationMutationObserver?.observe(element, {
                    childList: true,
                    characterData: true,
                    subtree: true,
                });
            });
            this.applyFixedDurationDisplay();
        });
    }

    private clearDurationMutationObserver(): void {
        if (this.durationMutationObserver === null) {
            return;
        }

        this.durationMutationObserver.disconnect();
        this.durationMutationObserver = null;
    }

    private bindSkipControls(): void {
        this.clearSkipControls();

        this.createSkipOverlay();
        this.keyDownListener = (event: KeyboardEvent) => {
            this.handleKeyDown(event);
        };
        this.showSkipOverlayListener = () => {
            this.showSkipOverlay();
        };
        this.hideSkipOverlayListener = () => {
            this.hideSkipOverlay(300);
        };

        document.addEventListener('keydown', this.keyDownListener);
        this.container.addEventListener('mousemove', this.showSkipOverlayListener);
        this.container.addEventListener('mouseenter', this.showSkipOverlayListener);
        this.container.addEventListener('touchstart', this.showSkipOverlayListener);
        this.container.addEventListener('mouseleave', this.hideSkipOverlayListener);
    }

    private clearSkipControls(): void {
        if (this.keyDownListener !== null) {
            document.removeEventListener('keydown', this.keyDownListener);
            this.keyDownListener = null;
        }
        if (this.showSkipOverlayListener !== null) {
            this.container.removeEventListener('mousemove', this.showSkipOverlayListener);
            this.container.removeEventListener('mouseenter', this.showSkipOverlayListener);
            this.container.removeEventListener('touchstart', this.showSkipOverlayListener);
            this.showSkipOverlayListener = null;
        }
        if (this.hideSkipOverlayListener !== null) {
            this.container.removeEventListener('mouseleave', this.hideSkipOverlayListener);
            this.hideSkipOverlayListener = null;
        }
        if (this.skipOverlayHideTimer !== null) {
            window.clearTimeout(this.skipOverlayHideTimer);
            this.skipOverlayHideTimer = null;
        }
        if (this.skipOverlay !== null) {
            this.skipOverlay.remove();
            this.skipOverlay = null;
        }
        this.playPauseButtonIcon = null;
    }

    private createSkipOverlay(): void {
        if (this.skipOverlay !== null) {
            return;
        }

        const computedStyle = window.getComputedStyle(this.container);
        if (computedStyle.position === 'static') {
            this.container.style.position = 'relative';
        }

        const overlay = document.createElement('div');
        overlay.className = 'recorded-streaming-skip-overlay';
        overlay.style.position = 'absolute';
        overlay.style.left = '50%';
        overlay.style.top = '50%';
        overlay.style.transform = 'translate(-50%, -50%)';
        overlay.style.display = 'flex';
        overlay.style.gap = '24px';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        overlay.style.transition = 'opacity 160ms ease';
        overlay.style.zIndex = '20';

        overlay.appendChild(this.createIconButton('mdi-rewind-30', () => this.seekBy(-30)));
        overlay.appendChild(this.createIconButton('mdi-rewind-10', () => this.seekBy(-10)));
        overlay.appendChild(this.createPlayPauseButton());
        overlay.appendChild(this.createIconButton('mdi-fast-forward-10', () => this.seekBy(10)));
        overlay.appendChild(this.createIconButton('mdi-fast-forward-30', () => this.seekBy(30)));

        this.container.appendChild(overlay);
        this.skipOverlay = overlay;
    }

    private createIconButton(iconName: string, callback: () => void, isPrimary: boolean = false): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.style.width = isPrimary === true ? '64px' : '52px';
        button.style.height = isPrimary === true ? '64px' : '52px';
        button.style.border = '0';
        button.style.borderRadius = '50%';
        button.style.background = 'transparent';
        button.style.color = '#fff';
        button.style.cursor = 'pointer';
        button.style.display = 'inline-flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.filter = 'drop-shadow(0 2px 3px rgba(0, 0, 0, 0.95))';
        button.style.opacity = '0.96';
        button.style.padding = '0';
        button.addEventListener('mouseenter', () => {
            button.style.background = 'rgba(255, 255, 255, 0.14)';
        });
        button.addEventListener('mouseleave', () => {
            button.style.background = 'transparent';
        });
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            callback();
            this.showSkipOverlay();
        });

        const icon = document.createElement('i');
        icon.className = `v-icon notranslate mdi ${iconName} theme--dark`;
        icon.setAttribute('aria-hidden', 'true');
        icon.style.color = '#fff';
        icon.style.fontSize = isPrimary === true ? '52px' : '42px';
        icon.style.lineHeight = '1';
        button.appendChild(icon);

        return button;
    }

    private createPlayPauseButton(): HTMLButtonElement {
        const button = this.createIconButton(this.getPlayPauseIconName(), () => this.togglePlay(), true);
        this.playPauseButtonIcon = button.querySelector<HTMLElement>('i');

        return button;
    }

    private showSkipOverlay(): void {
        if (this.skipOverlay === null) {
            return;
        }

        if (this.skipOverlayHideTimer !== null) {
            window.clearTimeout(this.skipOverlayHideTimer);
            this.skipOverlayHideTimer = null;
        }

        this.skipOverlay.style.opacity = '1';
        this.skipOverlay.style.pointerEvents = 'auto';
        this.hideSkipOverlay(2400);
    }

    private hideSkipOverlay(delay: number): void {
        if (this.skipOverlay === null) {
            return;
        }

        if (this.skipOverlayHideTimer !== null) {
            window.clearTimeout(this.skipOverlayHideTimer);
        }

        this.skipOverlayHideTimer = window.setTimeout(() => {
            if (this.skipOverlay === null) {
                return;
            }

            this.skipOverlay.style.opacity = '0';
            this.skipOverlay.style.pointerEvents = 'none';
            this.skipOverlayHideTimer = null;
        }, delay);
    }

    private handleKeyDown(event: KeyboardEvent): void {
        if (this.isKeyboardShortcutIgnored(event) === true) {
            return;
        }

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            this.seekBy(-5);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            this.seekBy(5);
        }
    }

    private togglePlay(): void {
        const video = this.player?.video;
        if (typeof video === 'undefined') {
            return;
        }

        if (video.paused === true) {
            video.play().catch(err => {
                this.onError?.(err);
            });
        } else {
            video.pause();
        }
        this.updatePlayPauseIcon();
    }

    private updatePlayPauseIcon(): void {
        if (this.playPauseButtonIcon === null) {
            return;
        }

        this.playPauseButtonIcon.className = `v-icon notranslate mdi ${this.getPlayPauseIconName()} theme--dark`;
    }

    private getPlayPauseIconName(): string {
        return this.player?.video.paused === true ? 'mdi-play' : 'mdi-pause';
    }

    private isKeyboardShortcutIgnored(event: KeyboardEvent): boolean {
        if (event.altKey === true || event.ctrlKey === true || event.metaKey === true) {
            return true;
        }

        const activeElement = document.activeElement;
        if (activeElement === null || activeElement instanceof HTMLElement === false) {
            return false;
        }

        const tagName = activeElement.tagName.toLowerCase();
        return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || activeElement.getAttribute('contenteditable') === 'true';
    }

    private seekBy(seconds: number): void {
        const video = this.player?.video;
        if (typeof video === 'undefined') {
            return;
        }

        const duration = this.getSeekableDuration(video);
        const maxTime = duration > 0 ? duration : Number.POSITIVE_INFINITY;
        const nextTime = Math.min(Math.max(video.currentTime + seconds, 0), maxTime);

        video.currentTime = nextTime;
        this.showSkipOverlay();
    }

    private getSeekableDuration(video: HTMLVideoElement): number {
        if (this.duration > 0) {
            return this.duration;
        }
        if (Number.isFinite(video.duration) === true && video.duration > 0) {
            return video.duration;
        }

        return 0;
    }

    private applyFixedDurationDisplay(): void {
        if (this.duration <= 0) {
            return;
        }

        window.requestAnimationFrame(() => {
            this.isApplyingDurationDisplay = true;
            const durationElements = this.container.querySelectorAll<HTMLElement>('.dplayer-dtime');
            durationElements.forEach(element => {
                element.textContent = this.formatTime(this.duration);
            });
            this.isApplyingDurationDisplay = false;
        });
    }

    private formatTime(seconds: number): string {
        const value = Math.max(0, Math.floor(seconds));
        const hour = Math.floor(value / 3600);
        const minute = Math.floor((value % 3600) / 60);
        const second = value % 60;
        const padding = (num: number): string => `0${num.toString(10)}`.slice(-2);

        return hour > 0 ? `${hour.toString(10)}:${padding(minute)}:${padding(second)}` : `${padding(minute)}:${padding(second)}`;
    }

    private bindMpegtsEvents(): void {
        if (this.player === null || this.type !== 'mpegts') {
            return;
        }

        const mpegtsPlayer = this.player.plugins.mpegts;
        if (mpegtsPlayer === undefined || typeof mpegtsPlayer.on !== 'function') {
            return;
        }

        mpegtsPlayer.on((Mpegts.Events as any).ERROR, (errorType: string, detail: string) => {
            this.onError?.(`[RecordedStreamingPlayer] mpegts.js error: ${errorType} ${detail}`);
        });
    }

    private restartJikkyoCommentCore(): void {
        this.destroyJikkyoCommentCore();
        this.initJikkyoCommentCore();
    }

    private initJikkyoCommentCore(): void {
        if (this.player === null || typeof this.jikkyoCommentsUrl === 'undefined') {
            return;
        }

        this.jikkyoCommentCore = new RecordedJikkyoCommentCore({
            commentsUrl: this.jikkyoCommentsUrl,
            video: this.player.video,
            onComment: comment => {
                this.player?.danmaku?.draw({
                    text: comment.text,
                    color: comment.color,
                    type: comment.position,
                    size: comment.size,
                });
            },
            onReset: () => {
                this.player?.danmaku?.clear();
            },
            onError: err => {
                this.onError?.(err);
            },
        });
        this.jikkyoCommentCore.start().catch(err => {
            this.onError?.(err);
        });
    }

    private destroyJikkyoCommentCore(): void {
        this.jikkyoCommentCore?.destroy();
        this.jikkyoCommentCore = null;
    }

    private handleInitError(err: any): void {
        this.onError?.(err);
        this.setState({
            isLoading: true,
            isBuffering: false,
            loadingText: 'プレイヤーの初期化に失敗しました。',
        });
    }

    private setState(state: Partial<RecordedStreamingPlayerState>): void {
        this.state = {
            ...this.state,
            ...state,
        };
        this.emitState();
    }

    private emitState(): void {
        this.onStateChange?.({ ...this.state });
    }
}
