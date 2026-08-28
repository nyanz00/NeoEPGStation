import DPlayer from 'dplayer';
import Hls from 'hls.js';
import Mpegts from 'mpegts.js';
import { isAppleMobileWebKit } from '../platform/webkit';
import { getStoredPlayerMuted, getStoredPlayerVolumePercent, setStoredPlayerMuted } from '../storage/player';
import type { WebKitPlaybackMode } from '../storage/settings';
import { configureDPlayerUi, DPLAYER_MOBILE_VOLUME_CONTROL_NAME, DPLAYER_VOLUME_ON_ICON, updateDPlayerMobileVolumeControl } from './DPlayerUi';
import {
    downloadCompositeScreenshot,
    downloadVideoScreenshot,
    DPLAYER_COMPOSITE_SCREENSHOT_CONTROL_NAME,
    DPLAYER_COMPOSITE_SCREENSHOT_ICON,
    type CompositeScreenshotDanmaku,
} from './PlayerCompositeScreenshot';
import { RecordedJikkyoCommentCore } from './RecordedJikkyoCommentCore';
import { PlayerVolumeController } from './PlayerVolumeController';
import type { JikkyoComment } from './jikkyoComment';

export type RecordedPlayerSourceType = 'normal' | 'hls' | 'mpegts';

interface DPlayerDanmakuItem {
    text: string;
    color: string;
    type: string;
    size: string;
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
        clear(): void;
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

export interface RecordedPlayerState {
    isLoading: boolean;
    isBuffering: boolean;
    loadingText: string;
}

export interface RecordedPlayerCoreOption {
    container: HTMLElement;
    src: string;
    type: RecordedPlayerSourceType;
    enableAribSubtitle: boolean;
    enableDanmaku: boolean;
    danmakuHighRefreshRate: boolean;
    forceSubtitleStroke: boolean;
    volumeBoostEnabled: boolean;
    volumeBoostMaxPercent: number;
    themeColor: string;
    webkitPlaybackMode: WebKitPlaybackMode;
    commentsUrl?: string;
    onReady?: (video: HTMLVideoElement) => void;
    onStateChange?: (state: RecordedPlayerState) => void;
    onComment?: (comment: JikkyoComment) => void;
    onCommentsReset?: () => void;
    onCommentStatus?: (detail: string) => void;
    onControlsVisibilityChange?: (visible: boolean) => void;
    onControlsPortalReady?: (container: HTMLElement | null) => void;
    onError?: (error: unknown) => void;
    autoplay: boolean;
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

export class RecordedPlayerCore {
    private static readonly CONTROLS_AUTO_HIDE_TIME = 1_500;
    private static readonly DANMAKU_FONT_SIZE = 34;
    private static readonly TS_HLS_RELOAD_SEEK_GAP = 12;
    private static readonly RELOAD_ICON =
        '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg>';

    private readonly option: RecordedPlayerCoreOption;
    private player: DPlayerInstance | null = null;
    private jikkyoCore: RecordedJikkyoCommentCore | null = null;
    private pendingComments: JikkyoComment[] = [];
    private commentFrame: number | null = null;
    private destroyed = false;
    private restarting = false;
    private playbackErrorTimer: number | null = null;
    private volumeController: PlayerVolumeController | null = null;
    private tsHlsSourceStartPosition = 0;
    private lastStablePlaybackPosition = 0;
    private tsHlsSeekReloading = false;
    private playbackFinished = false;
    private hlsBufferedToEnd = false;
    private hlsFinalFragmentBuffered = false;
    private hlsEndFallbackTimer: number | null = null;
    private state: RecordedPlayerState = { isLoading: true, isBuffering: false, loadingText: 'プレイヤーを初期化中...' };

    constructor(option: RecordedPlayerCoreOption) {
        this.option = option;
        this.emitState();
    }

    public async init(): Promise<void> {
        this.destroyed = false;
        await this.initPlayer();
    }

    public getVideoElement(): HTMLVideoElement | null {
        return this.player?.video ?? null;
    }

    public showControls(): void {
        this.player?.controller.setAutoHide(RecordedPlayerCore.CONTROLS_AUTO_HIDE_TIME);
    }

    public hideControls(): void {
        this.player?.controller.hide();
    }

    public activateAudio(): void {
        this.volumeController?.activateAudio();
        if (this.player === null || !isAppleMobileWebKit() || getStoredPlayerMuted() || !this.player.video.muted) return;
        this.player.video.muted = false;
        updateDPlayerMobileVolumeControl(this.option.container, false);
        void this.player.video.play().catch(error => this.option.onError?.(error));
    }

    public drawDanmaku(comment: JikkyoComment): void {
        this.enqueueComment(comment);
    }

    public clearDanmaku(): void {
        if (this.commentFrame !== null) window.cancelAnimationFrame(this.commentFrame);
        this.commentFrame = null;
        this.pendingComments = [];
        this.player?.danmaku?.clear();
    }

    public restart(): void {
        if (this.destroyed || this.restarting) return;
        this.restarting = true;
        this.setState({ isLoading: true, isBuffering: false, loadingText: 'プレイヤーを再読み込みしています...' });
        this.destroyPlayer();
        window.setTimeout(() => {
            this.restarting = false;
            if (!this.destroyed) void this.initPlayer().catch(error => this.handleError(error));
        }, 250);
    }

    public destroy(): void {
        this.destroyed = true;
        this.destroyPlayer();
    }

    private async initPlayer(): Promise<void> {
        if (this.destroyed) return;
        this.setState({ isLoading: true, isBuffering: false, loadingText: '動画を準備中...' });
        this.tsHlsSourceStartPosition = this.getSourceStartPosition(this.option.src);
        this.lastStablePlaybackPosition = this.tsHlsSourceStartPosition;
        this.tsHlsSeekReloading = false;
        this.playbackFinished = false;
        this.hlsBufferedToEnd = false;
        this.hlsFinalFragmentBuffered = false;
        this.clearHlsEndFallbackTimer();
        window.Hls = Hls;
        window.mpegts = Mpegts;
        const video: { url: string; type?: string } = { url: this.option.src };
        if (this.option.type === 'hls') video.type = 'hls';
        if (this.option.type === 'mpegts') video.type = 'mpegts';
        const autoplay = this.option.autoplay && !(isAppleMobileWebKit() && this.option.webkitPlaybackMode === 'ios26');
        const options: any = {
            container: this.option.container,
            theme: this.option.themeColor,
            controllerAutoHideTime: RecordedPlayerCore.CONTROLS_AUTO_HIDE_TIME,
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
                    icon: RecordedPlayerCore.RELOAD_ICON,
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
            live: false,
            autoplay,
            airplay: false,
            hotkey: true,
            screenshot: true,
            pictureInPicture: true,
            crossOrigin: 'anonymous',
            volume: Math.min(1, getStoredPlayerVolumePercent(this.option.volumeBoostEnabled ? this.option.volumeBoostMaxPercent : 100) / 100),
            playbackSpeed: [0.25, 0.5, 0.75, 1, 1.1, 1.25, 1.5, 1.75, 2],
            video,
            pluginOptions: {
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
                        liveBufferLatencyMinRemain: 3,
                        liveBufferLatencyMaxLatency: 8,
                    },
                },
                aribb24: aribb24Option(this.option.forceSubtitleStroke),
            },
        };
        if (this.option.enableAribSubtitle) options.subtitle = { type: 'aribb24' };
        if (this.option.commentsUrl !== undefined || this.option.enableDanmaku) {
            options.danmaku = {
                user: 'EPGStation',
                speedRate: 1,
                fontSize: RecordedPlayerCore.DANMAKU_FONT_SIZE,
                highRefreshRate: this.option.danmakuHighRefreshRate,
            };
            options.apiBackend = {
                read: (readOption: { success: (comments: never[]) => void }) => readOption.success([]),
                send: (sendOption: { error: (message: string) => void }) => sendOption.error('コメント投稿にはまだ対応していません。'),
            };
        }
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
            onError: this.option.onError,
        });
        if (storedMuted) this.player.muted(true);
        updateDPlayerMobileVolumeControl(this.option.container, this.player.video.muted);
        this.bindEvents();
        this.option.onReady?.(this.player.video);
        this.initJikkyoCore();
        if (autoplay && isAppleMobileWebKit()) {
            this.player.play();
        }
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
            this.option.onError?.(error);
        }
    }

    private async captureVideoScreenshot(): Promise<void> {
        if (this.player === null) return;
        try {
            await downloadVideoScreenshot(this.player.video);
        } catch (error) {
            this.player?.notice(error instanceof Error ? error.message : 'スクリーンショットの撮影に失敗しました。');
            this.option.onError?.(error);
        }
    }

    private bindEvents(): void {
        const player = this.player;
        if (player === null) return;
        player.on('waiting', () => {
            if (this.playbackFinished || player.video.ended) {
                this.finishPlayback();

                return;
            }
            this.setState({ ...this.state, isBuffering: true, loadingText: 'バッファリング中...' });
            this.scheduleHlsEndFallback(player);
        });
        player.on('playing', () => {
            this.playbackFinished = false;
            this.clearHlsEndFallbackTimer();
            this.clearPlaybackErrorTimer();
            this.setState({ isLoading: false, isBuffering: false, loadingText: '' });
            // Safari can emit an initialization pause after DPlayer's play event,
            // leaving the controls visible without an active auto-hide timer.
            // Restart it only once media is actually advancing.
            if (player.controller.isShow()) player.controller.setAutoHide(RecordedPlayerCore.CONTROLS_AUTO_HIDE_TIME);
        });
        player.on('canplay', () => {
            this.clearHlsEndFallbackTimer();
            this.clearPlaybackErrorTimer();
            this.setState({ isLoading: false, isBuffering: false, loadingText: '' });
        });
        player.on('pause', () => {
            player.controller.show();
            if (player.video.ended) {
                this.finishPlayback();

                return;
            }
            if (isAppleMobileWebKit() && this.option.autoplay && this.state.isLoading) {
                this.setState({ isLoading: false, isBuffering: false, loadingText: '' });
            }
        });
        player.on('ended', () => this.finishPlayback());
        const hls = player.plugins.hls as Hls | undefined;
        hls?.on(Hls.Events.MANIFEST_LOADING, () => {
            this.hlsBufferedToEnd = false;
            this.hlsFinalFragmentBuffered = false;
            this.clearHlsEndFallbackTimer();
        });
        hls?.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
            const details = hls.latestLevelDetails;
            if (details === null || details.live || data.frag.type !== 'main' || data.frag.sn !== details.endSN) return;
            this.hlsFinalFragmentBuffered = true;
            // The synthetic VOD playlist is published before all segments exist.
            // After a seek, hls.js can append its final fragment without advancing
            // its internal end-list tracker, leaving MediaSource open forever.
            // Explicitly close the muxed A/V source once that final fragment is in
            // the buffer so the browser can adjust duration to the actual media edge
            // and emit its native ended event after playing the remaining frames.
            if (!this.hlsBufferedToEnd) hls.trigger(Hls.Events.BUFFER_EOS, {});
            if (this.state.isBuffering) this.scheduleHlsEndFallback(player);
        });
        hls?.on(Hls.Events.BUFFERED_TO_END, () => {
            this.hlsBufferedToEnd = true;
            if (this.state.isBuffering) this.scheduleHlsEndFallback(player);
        });
        hls?.on(Hls.Events.MEDIA_ENDED, (_event, data) => {
            if (data.stalled) this.normalizeStalledHlsEnd(player);
            else this.finishPlayback();
        });
        player.on('timeupdate', () => {
            if (!player.video.seeking && !this.tsHlsSeekReloading) this.lastStablePlaybackPosition = player.video.currentTime;
        });
        player.on('seeking', () => {
            this.clearHlsEndFallbackTimer();
            this.playbackFinished = false;
            this.reloadTsHlsForLargeSeek(player);
        });
        player.on('volumechange', () => {
            updateDPlayerMobileVolumeControl(this.option.container, player.video.muted);
            setStoredPlayerMuted(player.video.muted);
        });
        player.on('error', () => {
            const video = player.video;
            const mediaError = video.error;
            const mediaErrorName =
                mediaError?.code === MediaError.MEDIA_ERR_ABORTED
                    ? 'MEDIA_ERR_ABORTED'
                    : mediaError?.code === MediaError.MEDIA_ERR_NETWORK
                      ? 'MEDIA_ERR_NETWORK'
                      : mediaError?.code === MediaError.MEDIA_ERR_DECODE
                        ? 'MEDIA_ERR_DECODE'
                        : mediaError?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
                          ? 'MEDIA_ERR_SRC_NOT_SUPPORTED'
                          : 'UNKNOWN';
            const error = new Error(
                `RecordedPlayerPlaybackError: ${mediaErrorName} code=${String(
                    mediaError?.code ?? 0,
                )} networkState=${video.networkState.toString(10)} readyState=${video.readyState.toString(10)} message=${mediaError?.message ?? ''}`,
            );
            this.option.onError?.(error);
            this.clearPlaybackErrorTimer();
            if (mediaError === null || mediaError.code === MediaError.MEDIA_ERR_ABORTED) return;
            this.playbackErrorTimer = window.setTimeout(() => {
                this.playbackErrorTimer = null;
                if (this.destroyed || this.player !== player || video.error === null || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
                this.setState({ isLoading: true, isBuffering: false, loadingText: '再生に失敗しました。再読み込みボタンを押してください。' });
            }, 2_500);
        });
        this.option.onControlsVisibilityChange?.(player.controller.isShow());
    }

    private finishPlayback(): void {
        this.playbackFinished = true;
        this.clearHlsEndFallbackTimer();
        this.clearPlaybackErrorTimer();
        this.setState({ isLoading: false, isBuffering: false, loadingText: '' });
        this.player?.controller.show();
    }

    private normalizeStalledHlsEnd(player: DPlayerInstance): void {
        if (this.destroyed || this.player !== player || this.playbackFinished) return;
        const video = player.video;
        this.playbackFinished = true;
        video.pause();
        // hls.js emits MEDIA_ENDED when MediaSource reached EOS but the browser
        // omitted its native ended event.  Re-emit it so DPlayer and playback
        // tracking complete through the same path as an ordinary media end.
        video.dispatchEvent(new Event('timeupdate'));
        video.dispatchEvent(new Event('ended'));
        this.finishPlayback();
    }

    private scheduleHlsEndFallback(player: DPlayerInstance): void {
        const hasConfirmedHlsEnd = this.hlsBufferedToEnd || this.hlsFinalFragmentBuffered;
        if ((!hasConfirmedHlsEnd && !this.isNearVodDuration(player)) || this.hlsEndFallbackTimer !== null || !this.isAtFinalBufferedRange(player)) return;
        const waitingAt = player.video.currentTime;
        this.hlsEndFallbackTimer = window.setTimeout(() => {
            this.hlsEndFallbackTimer = null;
            if (
                this.destroyed ||
                this.player !== player ||
                this.playbackFinished ||
                !this.state.isBuffering ||
                player.video.seeking ||
                Math.abs(player.video.currentTime - waitingAt) >= 0.05 ||
                !this.isAtFinalBufferedRange(player)
            ) {
                return;
            }
            this.normalizeStalledHlsEnd(player);
        }, 800);
    }

    private isNearVodDuration(player: DPlayerInstance): boolean {
        if (this.option.type !== 'hls') return false;
        const details = (player.plugins.hls as Hls | undefined)?.latestLevelDetails;
        const video = player.video;
        if (details?.live === true || !Number.isFinite(video.duration) || video.duration <= 0) return false;

        return video.duration - video.currentTime <= 2;
    }

    private isAtFinalBufferedRange(player: DPlayerInstance): boolean {
        if (this.option.type !== 'hls') return false;
        const hls = player.plugins.hls as Hls | undefined;
        const details = hls?.latestLevelDetails;
        const video = player.video;
        if (details?.live === true || video.buffered.length === 0) return false;
        const finalRange = video.buffered.length - 1;
        const start = video.buffered.start(finalRange);
        const end = video.buffered.end(finalRange);

        return video.currentTime >= start - 0.05 && video.currentTime <= end + 0.05 && end - video.currentTime <= 1;
    }

    private clearHlsEndFallbackTimer(): void {
        if (this.hlsEndFallbackTimer === null) return;
        window.clearTimeout(this.hlsEndFallbackTimer);
        this.hlsEndFallbackTimer = null;
    }

    private initJikkyoCore(): void {
        if (this.player === null || this.option.commentsUrl === undefined) return;
        this.jikkyoCore = new RecordedJikkyoCommentCore({
            commentsUrl: this.option.commentsUrl,
            video: this.player.video,
            onComment: comment => this.enqueueComment(comment),
            onReset: () => {
                this.player?.danmaku?.clear();
                this.option.onCommentsReset?.();
            },
            onStatus: detail => this.option.onCommentStatus?.(detail),
            onError: error => this.option.onError?.(error),
        });
        void this.jikkyoCore.start();
    }

    private reloadTsHlsForLargeSeek(player: DPlayerInstance): void {
        if (this.option.type !== 'hls' || !this.option.enableAribSubtitle || this.tsHlsSeekReloading || this.player !== player) return;
        const target = player.video.currentTime;
        if (!Number.isFinite(target) || target < 0 || Math.abs(target - this.lastStablePlaybackPosition) < RecordedPlayerCore.TS_HLS_RELOAD_SEEK_GAP) return;
        if (Math.abs(target - this.tsHlsSourceStartPosition) < 1 || this.isTimeBuffered(player.video, target)) return;
        const hls = player.plugins.hls as Hls | undefined;
        if (hls === undefined) return;

        const source = new URL(this.option.src, window.location.href);
        source.searchParams.set('ss', target.toFixed(3));
        const shouldResume = !player.video.paused;
        this.tsHlsSeekReloading = true;
        this.tsHlsSourceStartPosition = target;
        this.setState({ isLoading: true, isBuffering: true, loadingText: 'シーク先を準備中...' });
        player.video.pause();
        hls.stopLoad();
        hls.once(Hls.Events.MANIFEST_PARSED, () => {
            if (this.destroyed || this.player !== player) return;
            this.tsHlsSeekReloading = false;
            this.lastStablePlaybackPosition = target;
            player.video.currentTime = target;
            if (shouldResume) void player.video.play().catch(error => this.option.onError?.(error));
        });
        hls.loadSource(source.href);
        hls.startLoad(target);
    }

    private isTimeBuffered(video: HTMLVideoElement, time: number): boolean {
        for (let index = 0; index < video.buffered.length; index++) {
            if (time >= video.buffered.start(index) - 0.5 && time <= video.buffered.end(index) + 0.5) return true;
        }
        return false;
    }

    private getSourceStartPosition(source: string): number {
        try {
            const value = Number(new URL(source, window.location.href).searchParams.get('ss'));
            return Number.isFinite(value) && value >= 0 ? value : 0;
        } catch {
            return 0;
        }
    }

    private toggleMobileMuted(): void {
        if (this.player === null) return;
        this.player.video.muted = !this.player.video.muted;
        updateDPlayerMobileVolumeControl(this.option.container, this.player.video.muted);
        if (!this.player.video.muted) void this.player.video.play().catch(error => this.option.onError?.(error));
    }

    private enqueueComment(comment: JikkyoComment): void {
        this.pendingComments.push(comment);
        this.option.onComment?.(comment);
        if (this.commentFrame !== null) return;
        this.commentFrame = window.requestAnimationFrame(() => {
            this.commentFrame = null;
            const comments = this.pendingComments.splice(0);
            if (this.player === null || comments.length === 0) return;
            this.player.danmaku?.draw(comments.map(item => ({ text: item.text, color: item.color, type: item.position, size: item.size })));
        });
    }

    private destroyPlayer(): void {
        this.tsHlsSeekReloading = false;
        this.hlsBufferedToEnd = false;
        this.hlsFinalFragmentBuffered = false;
        this.clearHlsEndFallbackTimer();
        this.volumeController?.destroy();
        this.volumeController = null;
        this.option.onControlsPortalReady?.(null);
        this.clearPlaybackErrorTimer();
        this.jikkyoCore?.destroy();
        this.jikkyoCore = null;
        if (this.commentFrame !== null) window.cancelAnimationFrame(this.commentFrame);
        this.commentFrame = null;
        this.pendingComments = [];
        if (this.player !== null) {
            try {
                this.player.destroy();
            } catch (error) {
                this.option.onError?.(error);
            }
            this.player = null;
        }
        this.option.container.replaceChildren();
    }

    private handleError(error: unknown): void {
        this.option.onError?.(error);
        this.setState({ isLoading: true, isBuffering: false, loadingText: '再生に失敗しました。再読み込みボタンを押してください。' });
    }

    private clearPlaybackErrorTimer(): void {
        if (this.playbackErrorTimer === null) return;
        window.clearTimeout(this.playbackErrorTimer);
        this.playbackErrorTimer = null;
    }

    private setState(state: RecordedPlayerState): void {
        this.state = state;
        this.emitState();
    }

    private emitState(): void {
        this.option.onStateChange?.({ ...this.state });
    }
}
