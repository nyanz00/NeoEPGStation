import { JikkyoComment } from './JikkyoComment';

interface RecordedJikkyoComment {
    id: number;
    time: number;
    text: string;
    color: string;
    position: JikkyoComment['position'];
    size: JikkyoComment['size'];
    userId: string;
    postedAt: number;
}

interface RecordedJikkyoCommentsResponse {
    isSuccess: boolean;
    comments: RecordedJikkyoComment[];
    detail: string;
}

export interface RecordedJikkyoCommentCoreOption {
    commentsUrl: string;
    video: HTMLVideoElement;
    onComment: (comment: JikkyoComment) => void;
    onReset?: () => void;
    onError?: (err: any) => void;
}

export default class RecordedJikkyoCommentCore {
    private readonly option: RecordedJikkyoCommentCoreOption;
    private comments: RecordedJikkyoComment[] = [];
    private nextCommentIndex: number = 0;
    private animationFrameId: number | null = null;
    private abortController: AbortController | null = null;
    private isDestroyed: boolean = false;
    private lastCurrentTime: number = 0;

    constructor(option: RecordedJikkyoCommentCoreOption) {
        this.option = option;
    }

    public async start(): Promise<void> {
        this.isDestroyed = false;
        this.abortController = new AbortController();

        try {
            const response = await fetch(this.option.commentsUrl, {
                signal: this.abortController.signal,
            });
            if (response.ok === false) {
                throw new Error(`RecordedJikkyoCommentsRequestFailed: ${response.status.toString(10)}`);
            }

            const result = (await response.json()) as RecordedJikkyoCommentsResponse;
            if (this.isCoreDestroyed() === true) {
                return;
            }
            if (result.isSuccess === false) {
                this.comments = [];

                return;
            }

            this.comments = result.comments.filter(comment => Number.isFinite(comment.time) === true).sort((left, right) => left.time - right.time);
            this.resetPosition(this.option.video.currentTime, false);
            this.option.video.addEventListener('seeking', this.handleSeeking);
            this.option.video.addEventListener('seeked', this.handleSeeked);
            this.option.video.addEventListener('play', this.handlePlay);
            this.animationFrameId = window.requestAnimationFrame(this.tick);
        } catch (err) {
            const isAbortError = err instanceof DOMException && err.name === 'AbortError';
            if (this.isCoreDestroyed() === false && isAbortError === false) {
                this.option.onError?.(err);
            }
        }
    }

    public destroy(): void {
        this.isDestroyed = true;
        this.abortController?.abort();
        this.abortController = null;
        if (this.animationFrameId !== null) {
            window.cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.option.video.removeEventListener('seeking', this.handleSeeking);
        this.option.video.removeEventListener('seeked', this.handleSeeked);
        this.option.video.removeEventListener('play', this.handlePlay);
        this.comments = [];
        this.nextCommentIndex = 0;
    }

    private readonly tick = (): void => {
        if (this.isDestroyed === true) {
            return;
        }

        const video = this.option.video;
        if (video.paused === false && video.seeking === false) {
            const currentTime = video.currentTime;
            if (currentTime + 0.5 < this.lastCurrentTime || currentTime - this.lastCurrentTime > 2) {
                this.resetPosition(currentTime, true);
            }

            while (this.nextCommentIndex < this.comments.length && this.comments[this.nextCommentIndex].time <= currentTime + 0.05) {
                const comment = this.comments[this.nextCommentIndex];
                if (comment.time >= this.lastCurrentTime - 0.1) {
                    this.option.onComment({
                        id: comment.id,
                        text: comment.text,
                        color: comment.color,
                        position: comment.position,
                        size: comment.size,
                        userId: comment.userId,
                        postedAt: comment.postedAt,
                        vpos: null,
                    });
                }
                this.nextCommentIndex++;
            }
            this.lastCurrentTime = currentTime;
        }

        this.animationFrameId = window.requestAnimationFrame(this.tick);
    };

    private readonly handleSeeking = (): void => {
        this.resetPosition(this.option.video.currentTime, true);
    };

    private readonly handleSeeked = (): void => {
        this.resetPosition(this.option.video.currentTime, true);
    };

    private readonly handlePlay = (): void => {
        if (Math.abs(this.option.video.currentTime - this.lastCurrentTime) > 0.5) {
            this.resetPosition(this.option.video.currentTime, true);
        }
    };

    private resetPosition(time: number, clearComments: boolean): void {
        let low = 0;
        let high = this.comments.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (this.comments[middle].time < time) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }

        this.nextCommentIndex = low;
        this.lastCurrentTime = time;
        if (clearComments === true) {
            this.option.onReset?.();
        }
    }

    private isCoreDestroyed(): boolean {
        return this.isDestroyed;
    }
}
