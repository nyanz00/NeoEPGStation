export interface RecordedPlaybackSample {
    position: number;
    duration: number;
    watchedSecondsDelta: number;
    observedAt: number;
}

interface RecordedPlaybackTrackerOption {
    video: HTMLVideoElement;
    onStart: () => void;
    onProgress: (sample: RecordedPlaybackSample) => void;
}

/**
 * Tracks media time that advanced through normal playback. Seeking only changes the resume position.
 */
export class RecordedPlaybackTracker {
    private readonly video: HTMLVideoElement;
    private readonly onStart: () => void;
    private readonly onProgress: (sample: RecordedPlaybackSample) => void;
    private readonly timer: number;
    private lastPosition: number;
    private watchedSeconds = 0;
    private destroyed = false;

    constructor(option: RecordedPlaybackTrackerOption) {
        this.video = option.video;
        this.onStart = option.onStart;
        this.onProgress = option.onProgress;
        this.lastPosition = this.position();
        this.video.addEventListener('play', this.handlePlay);
        this.video.addEventListener('pause', this.handlePause);
        this.video.addEventListener('timeupdate', this.handleTimeUpdate);
        this.video.addEventListener('seeking', this.handleSeeking);
        this.video.addEventListener('seeked', this.handleSeeked);
        this.video.addEventListener('ended', this.handleEnded);
        window.addEventListener('pagehide', this.handlePageHide);
        this.timer = window.setInterval(() => this.flush(false), 5_000);
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.collect();
        this.flush(true);
        this.destroyed = true;
        window.clearInterval(this.timer);
        this.video.removeEventListener('play', this.handlePlay);
        this.video.removeEventListener('pause', this.handlePause);
        this.video.removeEventListener('timeupdate', this.handleTimeUpdate);
        this.video.removeEventListener('seeking', this.handleSeeking);
        this.video.removeEventListener('seeked', this.handleSeeked);
        this.video.removeEventListener('ended', this.handleEnded);
        window.removeEventListener('pagehide', this.handlePageHide);
    }

    private readonly handlePlay = (): void => {
        this.lastPosition = this.position();
        this.onStart();
        this.flush(true);
    };

    private readonly handlePause = (): void => {
        this.collect();
        this.flush(true);
    };

    private readonly handleTimeUpdate = (): void => this.collect();

    private readonly handleSeeking = (): void => {
        this.collect();
        this.flush(true);
        this.lastPosition = this.position();
    };

    private readonly handleSeeked = (): void => {
        this.lastPosition = this.position();
        this.flush(true);
    };

    private readonly handleEnded = (): void => {
        this.collect();
        this.flush(true, 0);
    };

    private readonly handlePageHide = (): void => {
        this.collect();
        this.flush(true);
    };

    private collect(): void {
        const current = this.position();
        const delta = current - this.lastPosition;
        if (!this.video.paused && !this.video.seeking && delta > 0) {
            const largestNormalAdvance = Math.max(15, Math.max(this.video.playbackRate, 1) * 10);
            if (delta <= largestNormalAdvance) this.watchedSeconds += delta;
        }
        this.lastPosition = current;
    }

    private flush(force: boolean, position = this.position()): void {
        const duration = this.video.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;
        if (!force && this.watchedSeconds <= 0) return;
        const watchedSecondsDelta = this.watchedSeconds;
        this.watchedSeconds = 0;
        this.onProgress({
            position: Math.min(Math.max(position, 0), duration),
            duration,
            watchedSecondsDelta,
            observedAt: Date.now(),
        });
    }

    private position(): number {
        return Number.isFinite(this.video.currentTime) ? Math.max(this.video.currentTime, 0) : 0;
    }
}
