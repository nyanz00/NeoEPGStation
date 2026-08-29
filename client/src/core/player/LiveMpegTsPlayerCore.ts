import DPlayer from 'dplayer';
import Hls from 'hls.js';
import Mpegts from 'mpegts.js';
import { isAppleMobileWebKit } from '../platform/webkit';
import { getStoredPlayerMuted, getStoredPlayerVolumePercent, setStoredPlayerMuted } from '../storage/player';
import type { WatchDanmakuFrameRateLimit, WebKitPlaybackMode } from '../storage/settings';
import { configureDPlayerUi, DPLAYER_MOBILE_VOLUME_CONTROL_NAME, DPLAYER_VOLUME_ON_ICON, updateDPlayerMobileVolumeControl } from './DPlayerUi';
import { LiveJikkyoCommentCore } from './LiveJikkyoCommentCore';
import {
    downloadCompositeScreenshot,
    downloadVideoScreenshot,
    DPLAYER_COMPOSITE_SCREENSHOT_CONTROL_NAME,
    DPLAYER_COMPOSITE_SCREENSHOT_ICON,
    type CompositeScreenshotDanmaku,
} from './PlayerCompositeScreenshot';
import { PlayerVolumeController } from './PlayerVolumeController';
import type { JikkyoComment } from './jikkyoComment';

interface DPlayerDanmakuItem {
    text: string;
    color: string;
    type: string;
    size: string;
}

interface DPlayerDanmakuSendOption {
    data: {
        text: string;
        color: string;
        type: 'top' | 'right' | 'bottom';
        size: 'big' | 'medium' | 'small';
    };
    success: () => void;
    error: (message: string) => void;
}

interface DPlayerInstance {
    video: HTMLVideoElement;
    plugins: Record<string, any>;
    controller: {
        setAutoHide(time?: number): void;
        show(): void;
        hide(): void;
        isShow(): boolean;
    };
    setting: {
        hide(): void;
    };
    volume(percentage?: number | string, nostorage?: boolean, nonotice?: boolean): number;
    notice(text: string): void;
    muted(muted?: boolean): boolean;
    play(): void;
    danmaku?: {
        draw(comment: DPlayerDanmakuItem | DPlayerDanmakuItem[]): void;
        resize?: () => void;
    } & CompositeScreenshotDanmaku;
    on(name: string, callback: () => void): void;
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
    isHevc: boolean;
    webkitPlaybackMode: WebKitPlaybackMode;
    forceSubtitleStroke: boolean;
    danmakuHighRefreshRate: boolean;
    danmakuFrameRateLimit: WatchDanmakuFrameRateLimit;
    volumeBoostEnabled: boolean;
    volumeBoostMaxPercent: number;
    themeColor: string;
    onReady?: (video: HTMLVideoElement | null) => void;
    onStateChange?: (state: LiveMpegTsPlayerState) => void;
    onComment?: (comment: JikkyoComment) => void;
    onCommentPostAvailabilityChange?: (available: boolean, detail?: string, target?: 'nicolive' | 'nx-jikkyo' | null) => void;
    onControlsVisibilityChange?: (visible: boolean) => void;
    onControlsPortalReady?: (container: HTMLElement | null) => void;
    onError?: (error: unknown) => void;
    onWarn?: (error: unknown) => void;
}

function sleep(time: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, time));
}

function isAppleSafari(): boolean {
    const userAgent = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && /Safari/.test(userAgent) && !/Chrome|Chromium/.test(userAgent));
}

function aribb24Option(forceSubtitleStroke: boolean): Record<string, unknown> {
    const windowsFirefox = /Windows/.test(navigator.userAgent) && /Firefox/.test(navigator.userAgent);
    const font = windowsFirefox
        ? '"Windows TV MaruGothic", "MS Gothic", "Yu Gothic", sans-serif'
        : '"Windows TV MaruGothic", "Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic Medium", sans-serif';
    return {
        normalFont: font,
        gaijiFont: font,
        drcsReplacement: true,
        enableAutoInBandMetadataTextTrackDetection: isAppleSafari() || !Hls.isSupported(),
        ...(forceSubtitleStroke ? { forceStrokeColor: 'black' } : {}),
    };
}

export class LiveMpegTsPlayerCore {
    private static readonly DANMAKU_FONT_SIZE = 34;
    private static readonly CONTROLS_AUTO_HIDE_TIME = 1_500;
    private static readonly LOW_LATENCY_START_BUFFER_SECONDS = 0.9;
    private static readonly NORMAL_START_BUFFER_SECONDS = 1.5;
    private static readonly START_BUFFER_WAIT_TIMEOUT = 5_000;
    private static readonly LIVE_COLOR = '#f44336';
    private static readonly RELOAD_ICON =
        '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg>';

    private readonly option: LiveMpegTsPlayerCoreOption;
    private player: DPlayerInstance | null = null;
    private jikkyoCommentCore: LiveJikkyoCommentCore | null = null;
    private destroyed = false;
    private restarting = false;
    private startupBuffering = false;
    private streamInputStarted = false;
    private safariAutoplayTemporarilyMuted = false;
    private restartTimer: number | null = null;
    private volumeController: PlayerVolumeController | null = null;
    private generation = 0;
    private pendingDanmaku: JikkyoComment[] = [];
    private danmakuFrame: number | null = null;
    private state: LiveMpegTsPlayerState = {
        isLoading: true,
        isBuffering: false,
        loadingText: 'プレイヤーを初期化中...',
    };

    constructor(option: LiveMpegTsPlayerCoreOption) {
        this.option = option;
        this.emitState();
    }

    public async init(): Promise<void> {
        this.destroyed = false;
        await this.initPlayer();
    }

    public restart(message = 'プレイヤーを再起動しています...'): void {
        if (this.destroyed || this.restarting) return;
        this.restarting = true;
        this.generation++;
        this.setState({ isLoading: true, isBuffering: false, loadingText: message });
        this.destroyPlayer();
        this.restartTimer = window.setTimeout(() => {
            this.restarting = false;
            void this.initPlayer().catch(error => this.handleInitError(error));
        }, 500);
    }

    public async sendComment(text: string, color: string, position: 'top' | 'right' | 'bottom', size: 'big' | 'medium' | 'small'): Promise<void> {
        if (this.jikkyoCommentCore === null) throw new Error('実況コメントへ接続していません');
        await this.jikkyoCommentCore.sendComment(text, color, position, size);
    }

    public showControls(): void {
        if (this.player === null) return;
        this.player.controller.setAutoHide(LiveMpegTsPlayerCore.CONTROLS_AUTO_HIDE_TIME);
    }

    public hideControls(): void {
        this.player?.controller.hide();
    }

    public activateAudio(): void {
        this.volumeController?.activateAudio();
        if (this.player === null || !isAppleMobileWebKit() || getStoredPlayerMuted() || !this.player.video.muted) return;
        this.safariAutoplayTemporarilyMuted = false;
        this.player.video.muted = false;
        updateDPlayerMobileVolumeControl(this.option.container, false);
        void this.player.video.play().catch(error => this.option.onWarn?.(error));
    }

    public destroy(): void {
        this.destroyed = true;
        this.generation++;
        if (this.restartTimer !== null) window.clearTimeout(this.restartTimer);
        this.restartTimer = null;
        this.destroyPlayer();
    }

    private async initPlayer(): Promise<void> {
        if (this.destroyed) return;
        const generation = this.generation;
        this.startupBuffering = false;
        this.streamInputStarted = false;
        this.setState({ isLoading: true, isBuffering: false, loadingText: 'チューナー起動中...' });
        window.mpegts = Mpegts;
        window.Hls = Hls;
        // Keep player creation in the originating user-activation task on Apple
        // devices. The worker capability probe is asynchronous and would otherwise
        // make Safari reject the first audible play request.
        const enableWorkerForMSE = isAppleMobileWebKit() ? false : await this.canUseWorkerForMSE();
        if (this.destroyed || generation !== this.generation) return;
        const startBufferSeconds = this.getStartBufferSeconds();
        const ios26HevcCompatibility = this.isIos26HevcCompatibilityPlayback();
        const options: any = {
            container: this.option.container,
            theme: this.option.themeColor,
            liveColor: LiveMpegTsPlayerCore.LIVE_COLOR,
            controllerAutoHideTime: LiveMpegTsPlayerCore.CONTROLS_AUTO_HIDE_TIME,
            controllerVisibilityCallback: (visible: boolean) => this.option.onControlsVisibilityChange?.(visible),
            volumeBarAlwaysVisible: true,
            customControls: [
                ...(isAppleMobileWebKit()
                    ? [
                          {
                              name: DPLAYER_MOBILE_VOLUME_CONTROL_NAME,
                              ariaLabel: 'ミュート',
                              icon: DPLAYER_VOLUME_ON_ICON,
                              position: 'left',
                              click: () => this.toggleMobileMuted(),
                          },
                      ]
                    : []),
                {
                    name: 'reload',
                    ariaLabel: 'プレイヤーを再読み込み',
                    icon: LiveMpegTsPlayerCore.RELOAD_ICON,
                    position: 'right',
                    click: () => this.restart(),
                },
                {
                    name: DPLAYER_COMPOSITE_SCREENSHOT_CONTROL_NAME,
                    ariaLabel: '字幕付きスクリーンショット',
                    icon: DPLAYER_COMPOSITE_SCREENSHOT_ICON,
                    position: 'right',
                    click: () => void this.captureCompositeScreenshot(),
                },
            ],
            lang: 'ja-jp',
            live: true,
            liveSyncMinBufferSize: this.option.lowLatency ? Math.max(0.1, startBufferSeconds - 0.1) : 4,
            // DPlayer seeks to the calculated live edge on every play(), while
            // mpegts.js simultaneously changes playbackRate to catch that edge.
            // Mobile Safari's HEVC MSE path can lose its decoded frame when both
            // corrections run during compatibility-mode autoplay, resulting in a
            // waiting -> playing -> waiting loop.  Positioning is handled once in
            // onCanPlay() for this combination instead.
            syncWhenPlayingLive: this.option.lowLatency && !ios26HevcCompatibility,
            autoplay: true,
            airplay: false,
            hotkey: false,
            screenshot: true,
            pictureInPicture: true,
            crossOrigin: 'anonymous',
            volume: Math.min(1, getStoredPlayerVolumePercent(this.option.volumeBoostEnabled ? this.option.volumeBoostMaxPercent : 100) / 100),
            video: { url: this.option.src, type: 'mpegts' },
            subtitle: { type: 'aribb24' },
            pluginOptions: {
                mpegts: {
                    config: {
                        enableWorker: true,
                        enableWorkerForMSE,
                        enableStashBuffer: true,
                        stashInitialSize: 2 * 1024 * 1024,
                        liveSync: this.option.lowLatency && !ios26HevcCompatibility,
                        liveSyncMaxLatency: 3,
                        liveSyncTargetLatency: startBufferSeconds,
                        liveSyncPlaybackRate: 1.1,
                    },
                },
                aribb24: aribb24Option(this.option.forceSubtitleStroke),
            },
            danmaku: {
                user: 'EPGStation',
                speedRate: 1,
                fontSize: LiveMpegTsPlayerCore.DANMAKU_FONT_SIZE,
                highRefreshRate: this.option.danmakuHighRefreshRate,
                maxFrameRate: this.option.danmakuFrameRateLimit === 'auto' ? undefined : Number(this.option.danmakuFrameRateLimit),
            },
            apiBackend: {
                read: (readOption: { success: (comments: never[]) => void }) => readOption.success([]),
                send: (sendOption: DPlayerDanmakuSendOption) => {
                    const { text, color, type, size } = sendOption.data;
                    void this.sendComment(text, this.dplayerColorToJikkyoColor(color), type, size)
                        .then(() => sendOption.success())
                        .catch(error => sendOption.error(error instanceof Error ? error.message : String(error)));
                },
            },
        };
        const storedMuted = getStoredPlayerMuted();
        this.player = new DPlayer(options) as DPlayerInstance;
        this.option.onControlsPortalReady?.(
            configureDPlayerUi(
                this.option.container,
                () => this.player?.setting.hide(),
                () => void this.captureVideoScreenshot(),
            ),
        );
        this.volumeController = new PlayerVolumeController({
            container: this.option.container,
            video: this.player.video,
            boostEnabled: this.option.volumeBoostEnabled,
            boostMaxPercent: this.option.volumeBoostMaxPercent,
            onVolumeNotice: volumePercent => this.player?.notice(`音量 ${volumePercent.toString(10)}%`),
            onError: this.option.onWarn,
        });
        const commentInput = this.option.container.querySelector<HTMLInputElement>('.dplayer-comment-input');
        if (commentInput !== null) {
            commentInput.maxLength = 75;
            commentInput.placeholder = 'コメントを入力してEnter';
            commentInput.autocomplete = 'off';
        }
        if (storedMuted) this.player.muted(true);
        updateDPlayerMobileVolumeControl(this.option.container, this.player.video.muted);
        this.option.onReady?.(this.player.video);
        this.bindPlayerEvents();
        this.initJikkyoCommentCore();
        this.startAppleAutoplay(storedMuted);
    }

    private async captureCompositeScreenshot(): Promise<void> {
        if (this.player === null) return;
        try {
            await downloadCompositeScreenshot({
                container: this.option.container,
                video: this.player.video,
                danmaku: this.player.danmaku,
            });
        } catch (error) {
            this.player?.notice(error instanceof Error ? error.message : 'スクリーンショットの撮影に失敗しました。');
            this.option.onWarn?.(error);
        }
    }

    private async captureVideoScreenshot(): Promise<void> {
        if (this.player === null) return;
        try {
            await downloadVideoScreenshot(this.player.video);
        } catch (error) {
            this.player?.notice(error instanceof Error ? error.message : 'スクリーンショットの撮影に失敗しました。');
            this.option.onWarn?.(error);
        }
    }

    private bindPlayerEvents(): void {
        if (this.player === null) return;
        this.player.on('waiting', () => {
            this.setState({
                ...this.state,
                isBuffering: true,
                loadingText: this.streamInputStarted ? 'バッファリング中...' : 'チューナー起動中...',
            });
        });
        this.player.on('playing', () => {
            // Safari's startup event order can leave the controller visible after
            // its initial pause. `playing` confirms playback before restarting
            // auto-hide and does not alter the touch/audio activation path.
            if (this.player?.controller.isShow()) this.player.controller.setAutoHide(LiveMpegTsPlayerCore.CONTROLS_AUTO_HIDE_TIME);
            if (this.isIos26HevcCompatibilityPlayback() && this.state.isLoading) {
                // `playing` is more reliable than Safari's canplay/readyState
                // bookkeeping: a decoded HEVC frame is actually advancing.
                this.setState({ isLoading: false, isBuffering: false, loadingText: '' });
                return;
            }
            if (!this.state.isLoading) this.setState({ ...this.state, isBuffering: false });
        });
        this.player.on('pause', () => {
            if (this.state.isLoading) return;
            this.player?.controller.show();
        });
        this.player.on('volumechange', () => {
            if (this.player === null) return;
            updateDPlayerMobileVolumeControl(this.option.container, this.player.video.muted);
            if (this.safariAutoplayTemporarilyMuted) return;
            setStoredPlayerMuted(this.player.video.muted);
        });
        this.option.onControlsVisibilityChange?.(this.player.controller.isShow());
        this.player.on('error', () => this.restart('再生エラーを検知しました。プレイヤーを再起動しています...'));
        this.player.on('canplay', () => void this.onCanPlay().catch(error => this.handleInitError(error)));
        this.bindMpegtsEvents();
        void this.ensureCanPlayFallback();
    }

    private bindMpegtsEvents(): void {
        const mpegtsPlayer = this.player?.plugins.mpegts;
        if (mpegtsPlayer === undefined || typeof mpegtsPlayer.on !== 'function') return;
        mpegtsPlayer.on((Mpegts.Events as any).ERROR, (errorType: string, detail: string) => {
            this.option.onError?.(new Error(`mpegts.js error: ${errorType} ${detail}`));
            this.restart(`ストリームエラーを検知しました。(${errorType}) プレイヤーを再起動しています...`);
        });
        const mediaInfoEvent = Mpegts.Events.MEDIA_INFO;
        if (mediaInfoEvent !== undefined) {
            mpegtsPlayer.on(mediaInfoEvent, async () => {
                this.markStreamInputStarted();
                await sleep(250);
                if (this.state.isLoading) await this.onCanPlay();
            });
        }
        const metadataArrivedEvent = Mpegts.Events.METADATA_ARRIVED;
        if (metadataArrivedEvent !== undefined) {
            mpegtsPlayer.on(metadataArrivedEvent, () => this.markStreamInputStarted());
        }
        const statisticsInfoEvent = Mpegts.Events.STATISTICS_INFO;
        if (statisticsInfoEvent !== undefined) {
            mpegtsPlayer.on(statisticsInfoEvent, (statistics: { speed?: number }) => {
                if (typeof statistics.speed === 'number' && statistics.speed > 0) this.markStreamInputStarted();
            });
        }
    }

    private markStreamInputStarted(): void {
        if (this.destroyed || this.player === null || this.streamInputStarted) return;
        this.streamInputStarted = true;
        if (!this.state.isLoading) return;
        this.setState({
            isLoading: true,
            isBuffering: true,
            loadingText: '映像を準備中...',
        });
    }

    private async ensureCanPlayFallback(): Promise<void> {
        await sleep(15_000);
        if (this.destroyed || this.player === null || !this.state.isLoading || this.startupBuffering) return;
        // Slow encoders can legitimately need more than 15 seconds. Reopening the
        // stream here leaves several long-lived HTTP responses competing for the
        // browser's per-host connection pool and eventually blocks ordinary APIs.
        this.setState({
            isLoading: true,
            isBuffering: true,
            loadingText: 'ストリームからのデータを待っています...',
        });
    }

    private async onCanPlay(): Promise<void> {
        if (this.player === null || !this.state.isLoading || this.startupBuffering) return;
        this.startupBuffering = true;
        const player = this.player;
        const video = player.video;

        try {
            this.setState({ isLoading: true, isBuffering: this.state.isBuffering, loadingText: '再生バッファを調整中...' });
            const freezePlayback = !isAppleMobileWebKit();
            if (freezePlayback) video.playbackRate = 0;
            const startBufferSeconds = this.getStartBufferSeconds();
            this.movePlaybackPositionIntoLatestBuffer(video, startBufferSeconds, this.isIos26HevcCompatibilityPlayback());

            // iOS 26 compatibility mode starts live playback muted so the first
            // play() remains inside Safari's autoplay policy.  Unlike desktop
            // browsers, playback cannot be frozen while the startup buffer grows.
            // Waiting for the desktop-sized target after Safari is already playing
            // can therefore consume the buffer as quickly as it is appended,
            // producing an endless waiting -> playing loop (especially with HEVC).
            if (this.isIos26HevcCompatibilityPlayback() && !video.paused && video.buffered.length > 0 && video.readyState >= video.HAVE_FUTURE_DATA) {
                this.setState({ isLoading: false, isBuffering: false, loadingText: '' });
                return;
            }

            const deadline = Date.now() + LiveMpegTsPlayerCore.START_BUFFER_WAIT_TIMEOUT;
            let bufferSeconds = this.getPlaybackBufferSeconds(video);
            while (!this.destroyed && this.player === player && bufferSeconds < startBufferSeconds && Date.now() < deadline) {
                await sleep(100);
                bufferSeconds = this.getPlaybackBufferSeconds(video);
            }
            if (this.destroyed || this.player !== player) return;

            if (video.buffered.length === 0 || video.readyState < video.HAVE_FUTURE_DATA) {
                if (freezePlayback) video.playbackRate = 1;
                this.startupBuffering = false;
                this.setState({
                    isLoading: true,
                    isBuffering: true,
                    loadingText: '再生可能なデータを待っています...',
                });
                return;
            }

            this.movePlaybackPositionIntoLatestBuffer(video, startBufferSeconds);
            if (freezePlayback) video.playbackRate = 1;
            this.setState({ isLoading: false, isBuffering: false, loadingText: '' });
            await this.recoverPlayback();
        } finally {
            this.startupBuffering = false;
        }
    }

    private getStartBufferSeconds(): number {
        return this.option.lowLatency ? LiveMpegTsPlayerCore.LOW_LATENCY_START_BUFFER_SECONDS : LiveMpegTsPlayerCore.NORMAL_START_BUFFER_SECONDS;
    }

    private isIos26HevcCompatibilityPlayback(): boolean {
        return isAppleMobileWebKit() && this.option.webkitPlaybackMode === 'ios26' && this.option.isHevc;
    }

    private async canUseWorkerForMSE(): Promise<boolean> {
        if (!this.option.isHevc) return true;
        const supportWorkerForMSEH265Playback = (Mpegts as any).supportWorkerForMSEH265Playback;
        if (typeof supportWorkerForMSEH265Playback !== 'function') return false;
        try {
            return (await supportWorkerForMSEH265Playback()) === true;
        } catch (error) {
            this.option.onWarn?.(error);
            return false;
        }
    }

    private getPlaybackBufferSeconds(video: HTMLVideoElement): number {
        if (video.buffered.length === 0) return 0;
        try {
            return Math.max(video.buffered.end(video.buffered.length - 1) - video.currentTime, 0);
        } catch {
            return 0;
        }
    }

    private movePlaybackPositionIntoLatestBuffer(video: HTMLVideoElement, targetBufferSeconds: number, forceLatestRange = false): void {
        if (video.buffered.length === 0) return;
        if (!forceLatestRange) {
            for (let index = 0; index < video.buffered.length; index++) {
                if (video.buffered.start(index) <= video.currentTime && video.currentTime <= video.buffered.end(index)) return;
            }
        }

        const latestIndex = video.buffered.length - 1;
        const latestStart = video.buffered.start(latestIndex);
        const latestEnd = video.buffered.end(latestIndex);
        const target = Math.max(latestStart, latestEnd - targetBufferSeconds);
        try {
            if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target;
        } catch (error) {
            this.option.onWarn?.(error);
        }
    }

    private startAppleAutoplay(storedMuted: boolean): void {
        if (this.player === null || !isAppleMobileWebKit()) return;
        const player = this.player;
        const video = player.video;
        if (this.option.webkitPlaybackMode === 'ios26' && !storedMuted) {
            this.safariAutoplayTemporarilyMuted = true;
            video.muted = true;
            updateDPlayerMobileVolumeControl(this.option.container, true);
        }
        player.play();
    }

    private toggleMobileMuted(): void {
        if (this.player === null) return;
        this.safariAutoplayTemporarilyMuted = false;
        this.player.video.muted = !this.player.video.muted;
        updateDPlayerMobileVolumeControl(this.option.container, this.player.video.muted);
        if (!this.player.video.muted) void this.player.video.play().catch(error => this.option.onWarn?.(error));
    }

    private async recoverPlayback(): Promise<void> {
        if (this.player === null) return;
        const player = this.player;
        const video = player.video;
        if (!video.paused) return;
        try {
            await video.play();
        } catch (error) {
            if (this.destroyed || this.player !== player) return;
            if (!isAppleMobileWebKit() || this.option.webkitPlaybackMode !== 'ios26' || video.muted) {
                this.option.onWarn?.(error);
                return;
            }
            this.safariAutoplayTemporarilyMuted = true;
            video.muted = true;
            try {
                await video.play();
            } catch (mutedError) {
                this.option.onWarn?.(mutedError);
            }
        }
    }

    private initJikkyoCommentCore(): void {
        if (this.player === null) return;
        this.jikkyoCommentCore = new LiveJikkyoCommentCore({
            channelId: this.option.channelId,
            video: this.player.video,
            onComment: comment => this.enqueueDanmaku(comment),
            onPostAvailabilityChange: (available, detail, target) => {
                this.option.container.classList.toggle('onair-comment-post-enabled', available);
                this.option.onCommentPostAvailabilityChange?.(available, detail, target);
            },
            onError: error => this.option.onWarn?.(error),
        });
        void this.jikkyoCommentCore.start();
    }

    private dplayerColorToJikkyoColor(color: string): string {
        const normalized = color.toLowerCase();
        const colors: Record<string, string> = {
            '#ffeaea': 'white',
            '#ffffff': 'white',
            '#f02840': 'red',
            '#fd7e80': 'red',
            '#fda708': 'orange',
            '#ffe133': 'yellow',
            '#64dd17': 'green',
            '#00d4f5': 'cyan',
            '#4763ff': 'blue',
        };
        return colors[normalized] ?? 'white';
    }

    private enqueueDanmaku(comment: JikkyoComment): void {
        this.pendingDanmaku.push(comment);
        this.option.onComment?.(comment);
        if (this.danmakuFrame !== null) return;

        // NX-Jikkyo may deliver multiple comments between two paints. Drawing each
        // message immediately repeats DOM insertion and text measurement work and can
        // stall animations already in flight. Flush one fragment per animation frame.
        this.danmakuFrame = window.requestAnimationFrame(() => {
            this.danmakuFrame = null;
            const comments = this.pendingDanmaku.splice(0);
            if (this.destroyed || this.player === null || comments.length === 0) return;
            this.player.danmaku?.draw(comments.map(item => ({ text: item.text, color: item.color, type: item.position, size: item.size })));
        });
    }

    private destroyPlayer(): void {
        this.volumeController?.destroy();
        this.volumeController = null;
        this.startupBuffering = false;
        this.streamInputStarted = false;
        this.safariAutoplayTemporarilyMuted = false;
        this.jikkyoCommentCore?.destroy();
        this.jikkyoCommentCore = null;
        this.option.container.classList.remove('onair-comment-post-enabled');
        this.option.onControlsPortalReady?.(null);
        if (this.danmakuFrame !== null) window.cancelAnimationFrame(this.danmakuFrame);
        this.danmakuFrame = null;
        this.pendingDanmaku = [];
        this.option.onReady?.(null);
        if (this.player === null) return;
        const player = this.player;
        const video = player.video;
        this.player = null;
        try {
            player.destroy();
        } catch (error) {
            this.option.onError?.(error);
        }
        try {
            // Explicitly abort the media request as well. Some DPlayer/mpegts.js
            // error paths leave it alive after destroy(), which can starve later API
            // requests until the server closes the stream.
            video.pause();
            video.removeAttribute('src');
            video.load();
        } catch (error) {
            this.option.onWarn?.(error);
        }
        this.option.container.replaceChildren();
    }

    private handleInitError(error: unknown): void {
        this.option.onError?.(error);
        this.setState({ isLoading: true, isBuffering: false, loadingText: 'プレイヤーの初期化に失敗しました。' });
    }

    private setState(state: LiveMpegTsPlayerState): void {
        this.state = state;
        this.emitState();
    }

    private emitState(): void {
        this.option.onStateChange?.({ ...this.state });
    }
}
