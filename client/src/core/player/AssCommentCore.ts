import type { JikkyoComment } from './jikkyoComment';
import { parseAssComments as parseNormalizedAssComments } from '../../../../src/util/AssCommentParser';

interface TimelineComment {
    time: number;
    displayTime: number;
    comment: JikkyoComment;
}

export interface AssCommentCoreOption {
    ass: string;
    video: HTMLVideoElement;
    onComment: (comment: JikkyoComment) => void;
    onCommentsChange?: (comments: JikkyoComment[]) => void;
    onPositionChange?: (nextCommentIndex: number) => void;
    getDisplayTime?: (comment: JikkyoComment, originalTime: number) => number;
    onReset?: () => void;
}

export class AssCommentCore {
    private readonly option: AssCommentCoreOption;
    private comments: TimelineComment[];
    private nextCommentIndex = 0;
    private animationFrameId: number | null = null;
    private lastCurrentTime = 0;
    private destroyed = false;

    constructor(option: AssCommentCoreOption) {
        this.option = option;
        this.comments = parseAssComments(option.ass);
        this.refreshDisplayTimes();
    }

    public start(): void {
        this.destroyed = false;
        this.notifyCommentsChanged();
        this.resetPosition(this.option.video.currentTime, false);
        this.option.video.addEventListener('seeking', this.handleSeeking);
        this.option.video.addEventListener('seeked', this.handleSeeked);
        this.option.video.addEventListener('play', this.handlePlay);
        this.option.video.addEventListener('durationchange', this.handleDurationChange);
        this.animationFrameId = window.requestAnimationFrame(this.tick);
    }

    public updateAss(ass: string): void {
        this.comments = parseAssComments(ass);
        this.refreshDisplayTimes();
        this.notifyCommentsChanged();
        // Keep comments that are already moving on screen.  Start the new
        // timeline just after the current position so the event at the swap
        // boundary is not emitted twice.
        this.resetPosition(this.option.video.currentTime + 0.1, false);
    }

    public destroy(): void {
        this.destroyed = true;
        if (this.animationFrameId !== null) window.cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
        this.option.video.removeEventListener('seeking', this.handleSeeking);
        this.option.video.removeEventListener('seeked', this.handleSeeked);
        this.option.video.removeEventListener('play', this.handlePlay);
        this.option.video.removeEventListener('durationchange', this.handleDurationChange);
    }

    private readonly tick = (): void => {
        if (this.destroyed) return;
        const video = this.option.video;
        if (!video.paused && !video.seeking) {
            const currentTime = video.currentTime;
            if (currentTime + 0.5 < this.lastCurrentTime || currentTime - this.lastCurrentTime > 2) this.resetPosition(currentTime, true);
            const previousIndex = this.nextCommentIndex;
            while (this.nextCommentIndex < this.comments.length && this.comments[this.nextCommentIndex].displayTime <= currentTime + 0.05) {
                const item = this.comments[this.nextCommentIndex];
                if (item.displayTime >= this.lastCurrentTime - 0.1) this.option.onComment(item.comment);
                this.nextCommentIndex++;
            }
            if (this.nextCommentIndex !== previousIndex) this.option.onPositionChange?.(this.nextCommentIndex);
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
        this.refreshDisplayTimes();
        this.resetPosition(this.option.video.currentTime, false);
    };

    private refreshDisplayTimes(): void {
        for (const item of this.comments) {
            item.displayTime = this.option.getDisplayTime?.(item.comment, item.time) ?? item.time;
        }
        this.comments.sort((left, right) => left.displayTime - right.displayTime || left.time - right.time);
    }

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
        this.option.onPositionChange?.(this.nextCommentIndex);
        if (reset) this.option.onReset?.();
    }

    private notifyCommentsChanged(): void {
        this.option.onCommentsChange?.(this.comments.map(item => item.comment));
    }
}

function parseAssComments(ass: string): TimelineComment[] {
    return parseNormalizedAssComments(ass).map(item => ({
        time: item.time,
        displayTime: item.time,
        comment: {
            id: item.id,
            text: item.text,
            color: item.color,
            position: item.position,
            size: item.size,
            userId: item.userId,
            postedAt: item.postedAt,
            vpos: Math.round(item.time * 100),
        },
    }));
}
