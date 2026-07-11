import { JikkyoComment, JikkyoCommentPosition, JikkyoCommentSize } from './JikkyoComment';

interface AssStyle {
    name: string;
    fontSize: number;
    primaryColor: string;
    alignment: number;
}

interface AssDanmakuComment {
    id: number;
    time: number;
    comment: JikkyoComment;
}

export interface AssDanmakuCommentCoreOption {
    ass: string;
    video: HTMLVideoElement;
    onComment: (comment: JikkyoComment) => void;
    onReset?: () => void;
}

const OVERRIDE_TAG_PATTERN = /\{[^}]*\}/g;

export default class AssDanmakuCommentCore {
    private readonly option: AssDanmakuCommentCoreOption;
    private readonly comments: AssDanmakuComment[];
    private nextCommentIndex: number = 0;
    private animationFrameId: number | null = null;
    private lastCurrentTime: number = 0;
    private isDestroyed: boolean = false;

    constructor(option: AssDanmakuCommentCoreOption) {
        this.option = option;
        this.comments = this.parse(option.ass);
    }

    public start(): void {
        this.isDestroyed = false;
        this.resetPosition(this.option.video.currentTime, false);
        this.option.video.addEventListener('seeking', this.handleSeeking);
        this.option.video.addEventListener('seeked', this.handleSeeked);
        this.option.video.addEventListener('play', this.handlePlay);
        this.animationFrameId = window.requestAnimationFrame(this.tick);
    }

    public destroy(): void {
        this.isDestroyed = true;
        if (this.animationFrameId !== null) {
            window.cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.option.video.removeEventListener('seeking', this.handleSeeking);
        this.option.video.removeEventListener('seeked', this.handleSeeked);
        this.option.video.removeEventListener('play', this.handlePlay);
        this.option.onReset?.();
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
                const item = this.comments[this.nextCommentIndex];
                if (item.time >= this.lastCurrentTime - 0.1) {
                    this.option.onComment(item.comment);
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

    private parse(ass: string): AssDanmakuComment[] {
        const styles = this.parseStyles(ass);
        const comments: AssDanmakuComment[] = [];
        const lines = ass.split(/\r?\n/);
        let section = '';
        let eventFormat: string[] = [];

        for (const line of lines) {
            const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
            if (sectionMatch !== null) {
                section = sectionMatch[1].toLowerCase();
                continue;
            }
            if (section !== 'events') {
                continue;
            }
            if (/^\s*Format:/i.test(line) === true) {
                eventFormat = line
                    .slice(line.indexOf(':') + 1)
                    .split(',')
                    .map(field => field.trim().toLowerCase());
                continue;
            }
            if (/^\s*Dialogue:/i.test(line) === false || eventFormat.length === 0) {
                continue;
            }

            const values = this.splitFields(line.slice(line.indexOf(':') + 1).trimStart(), eventFormat.length);
            const fields = this.mapFields(eventFormat, values);
            const time = this.parseTime(fields.start);
            const rawText = fields.text ?? '';
            const text = this.toPlainText(rawText);
            if (time === null || text.length === 0 || this.isDrawing(rawText) === true) {
                continue;
            }

            const style = styles.get((fields.style ?? '').toLowerCase());
            const position = this.getPosition(rawText, style, fields.style ?? '');
            const size = this.getSize(rawText, style, fields.style ?? '');
            comments.push({
                id: comments.length,
                time,
                comment: {
                    id: comments.length,
                    text,
                    color: this.getColor(rawText, style),
                    position,
                    size,
                    userId: fields.name ?? '',
                    postedAt: 0,
                    vpos: Math.round(time * 100),
                },
            });
        }

        return comments.sort((left, right) => left.time - right.time);
    }

    private parseStyles(ass: string): Map<string, AssStyle> {
        const styles = new Map<string, AssStyle>();
        const lines = ass.split(/\r?\n/);
        let section = '';
        let styleFormat: string[] = [];

        for (const line of lines) {
            const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
            if (sectionMatch !== null) {
                section = sectionMatch[1].toLowerCase();
                continue;
            }
            if (section !== 'v4+ styles' && section !== 'v4 styles') {
                continue;
            }
            if (/^\s*Format:/i.test(line) === true) {
                styleFormat = line
                    .slice(line.indexOf(':') + 1)
                    .split(',')
                    .map(field => field.trim().toLowerCase());
                continue;
            }
            if (/^\s*Style:/i.test(line) === false || styleFormat.length === 0) {
                continue;
            }

            const values = this.splitFields(line.slice(line.indexOf(':') + 1).trimStart(), styleFormat.length);
            const fields = this.mapFields(styleFormat, values);
            const name = fields.name ?? '';
            if (name.length === 0) {
                continue;
            }
            styles.set(name.toLowerCase(), {
                name,
                fontSize: Number(fields.fontsize ?? 36),
                primaryColor: fields.primarycolour ?? '&H00FFFFFF',
                alignment: Number(fields.alignment ?? 2),
            });
        }

        return styles;
    }

    private splitFields(value: string, count: number): string[] {
        const fields: string[] = [];
        let start = 0;
        for (let index = 0; index < value.length && fields.length < count - 1; index++) {
            if (value[index] === ',') {
                fields.push(value.slice(start, index));
                start = index + 1;
            }
        }
        fields.push(value.slice(start));
        return fields;
    }

    private mapFields(format: string[], values: string[]): { [key: string]: string } {
        const fields: { [key: string]: string } = {};
        format.forEach((name, index) => {
            fields[name] = values[index] ?? '';
        });
        return fields;
    }

    private parseTime(value: string | undefined): number | null {
        const match = value?.trim().match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
        if (match === null || typeof match === 'undefined') {
            return null;
        }
        const time = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        return Number.isFinite(time) === true ? time : null;
    }

    private toPlainText(value: string): string {
        return value
            .replace(OVERRIDE_TAG_PATTERN, '')
            .replace(/\\[Nn]/g, '\n')
            .replace(/\\h/g, ' ')
            .trim();
    }

    private isDrawing(value: string): boolean {
        return /\\p[1-9]\d*/i.test(value);
    }

    private getPosition(value: string, style: AssStyle | undefined, styleName: string): JikkyoCommentPosition {
        const normalizedStyleName = styleName.toLowerCase();
        if (/\\move\s*\(/i.test(value) === true || /normal|naka|scroll|right/.test(normalizedStyleName) === true) {
            return 'right';
        }
        const alignmentMatch = value.match(/\\an([1-9])/i);
        const alignment = alignmentMatch === null ? style?.alignment ?? 2 : Number(alignmentMatch[1]);
        if (/top|ue/.test(normalizedStyleName) === true || alignment >= 7) {
            return 'top';
        }
        if (/bottom|shita/.test(normalizedStyleName) === true || alignment <= 3) {
            return 'bottom';
        }
        return 'right';
    }

    private getSize(value: string, style: AssStyle | undefined, styleName: string): JikkyoCommentSize {
        const normalizedStyleName = styleName.toLowerCase();
        if (/big|large/.test(normalizedStyleName) === true) {
            return 'big';
        }
        if (/small/.test(normalizedStyleName) === true) {
            return 'small';
        }

        const overrideSize = value.match(/\\fs(\d+(?:\.\d+)?)/i);
        const fontSize = overrideSize === null ? style?.fontSize : Number(overrideSize[1]);
        const baseSize = style?.fontSize;
        if (typeof fontSize === 'number' && typeof baseSize === 'number' && baseSize > 0) {
            if (fontSize >= baseSize * 1.2) {
                return 'big';
            }
            if (fontSize <= baseSize * 0.85) {
                return 'small';
            }
        }
        return 'medium';
    }

    private getColor(value: string, style: AssStyle | undefined): string {
        const overrideColor = value.match(/\\(?:1?c)&H([0-9a-f]{6,8})&/i);
        return this.convertAssColor(overrideColor?.[1] ?? style?.primaryColor ?? 'FFFFFF');
    }

    private convertAssColor(value: string): string {
        const hex = value.replace(/^&H/i, '').replace(/&$/, '').padStart(6, '0').slice(-6);
        return `#${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
    }
}
