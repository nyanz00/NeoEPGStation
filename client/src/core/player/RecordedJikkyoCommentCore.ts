import type { RecordedJikkyoComment, RecordedJikkyoComments } from '../../../../api';
import type { JikkyoComment } from './jikkyoComment';

export interface RecordedJikkyoCommentCoreOption {
    commentsUrl: string;
    video: HTMLVideoElement;
    onComment: (comment: JikkyoComment) => void;
    getDisplayTime?: (comment: JikkyoComment, originalTime: number) => number;
    onReset?: () => void;
    onStatus?: (detail: string) => void;
    onError?: (error: unknown) => void;
}

interface ScheduledComment {
    comment: RecordedJikkyoComment;
    displayTime: number;
}

export class RecordedJikkyoCommentCore {
    private readonly option: RecordedJikkyoCommentCoreOption;
    private comments: ScheduledComment[] = [];
    private nextCommentIndex = 0;
    private animationFrameId: number | null = null;
    private abortController: AbortController | null = null;
    private destroyed = false;
    private lastCurrentTime = 0;

    constructor(option: RecordedJikkyoCommentCoreOption) {
        this.option = option;
    }

    public async start(): Promise<void> {
        this.destroyed = false;
        this.abortController = new AbortController();
        try {
            const response = await fetch(this.option.commentsUrl, { signal: this.abortController.signal });
            if (!response.ok) throw new Error(`RecordedJikkyoCommentsRequestFailed: ${response.status.toString(10)}`);
            const result = (await response.json()) as RecordedJikkyoComments;
            if (this.destroyed) return;
            this.option.onStatus?.(result.detail);
            this.comments = result.isSuccess
                ? result.comments
                      .filter(comment => Number.isFinite(comment.time))
                      .map(comment => ({
                          comment,
                          displayTime: this.option.getDisplayTime?.({ ...comment, vpos: Math.round(comment.time * 100) }, comment.time) ?? comment.time,
                      }))
                      .sort((left, right) => left.displayTime - right.displayTime || left.comment.time - right.comment.time)
                : [];
            this.resetPosition(this.option.video.currentTime, false);
            this.option.video.addEventListener('seeking', this.handleSeeking);
            this.option.video.addEventListener('seeked', this.handleSeeked);
            this.option.video.addEventListener('play', this.handlePlay);
            this.option.video.addEventListener('durationchange', this.handleDurationChange);
            this.animationFrameId = window.requestAnimationFrame(this.tick);
        } catch (error) {
            const aborted = error instanceof DOMException && error.name === 'AbortError';
            if (!this.destroyed && !aborted) this.option.onError?.(error);
        }
    }

    public destroy(): void {
        this.destroyed = true;
        this.abortController?.abort();
        this.abortController = null;
        if (this.animationFrameId !== null) window.cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
        this.option.video.removeEventListener('seeking', this.handleSeeking);
        this.option.video.removeEventListener('seeked', this.handleSeeked);
        this.option.video.removeEventListener('play', this.handlePlay);
        this.option.video.removeEventListener('durationchange', this.handleDurationChange);
        this.comments = [];
        this.nextCommentIndex = 0;
    }

    private readonly tick = (): void => {
        if (this.destroyed) return;
        const video = this.option.video;
        if (!video.paused && !video.seeking) {
            const currentTime = video.currentTime;
            if (currentTime + 0.5 < this.lastCurrentTime || currentTime - this.lastCurrentTime > 2) this.resetPosition(currentTime, true);
            while (this.nextCommentIndex < this.comments.length && this.comments[this.nextCommentIndex].displayTime <= currentTime + 0.05) {
                const item = this.comments[this.nextCommentIndex];
                if (item.displayTime >= this.lastCurrentTime - 0.1) {
                    this.option.onComment({ ...item.comment, vpos: Math.round(item.comment.time * 100) });
                }
                this.nextCommentIndex++;
            }
            this.lastCurrentTime = currentTime;
        }
        this.animationFrameId = window.requestAnimationFrame(this.tick);
    };

    private readonly handleSeeking = (): void => this.resetPosition(this.option.video.currentTime, true);
    private readonly handleSeeked = (): void => this.resetPosition(this.option.video.currentTime, true);
    private readonly handlePlay = (): void => {
        if (Math.abs(this.option.video.currentTime - this.lastCurrentTime) > 0.5) this.resetPosition(this.option.video.currentTime, true);
    };
    private readonly handleDurationChange = (): void => {
        for (const item of this.comments) {
            item.displayTime = this.option.getDisplayTime?.({ ...item.comment, vpos: Math.round(item.comment.time * 100) }, item.comment.time) ?? item.comment.time;
        }
        this.comments.sort((left, right) => left.displayTime - right.displayTime || left.comment.time - right.comment.time);
        this.resetPosition(this.option.video.currentTime, false);
    };

    private resetPosition(time: number, reset: boolean): void {
        let low = 0;
        let high = this.comments.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (this.comments[middle].displayTime < time) low = middle + 1;
            else high = middle;
        }
        this.nextCommentIndex = low;
        this.lastCurrentTime = time;
        if (reset) this.option.onReset?.();
    }
}
