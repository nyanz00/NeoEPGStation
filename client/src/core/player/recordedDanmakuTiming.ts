import type { JikkyoComment } from './jikkyoComment';

const DANMAKU_FONT_SIZE = 34;
const DANMAKU_MAX_DURATION_SECONDS = 5.5;

let measureContext: CanvasRenderingContext2D | null = null;

export function getRecordedDanmakuDisplayTime(comment: JikkyoComment, originalTime: number, video: HTMLVideoElement, container: HTMLElement): number {
    if (comment.position !== 'right' || !Number.isFinite(originalTime) || originalTime < 0) return originalTime;

    const videoDuration = video.duration;
    const containerWidth = container.clientWidth;
    if (!Number.isFinite(videoDuration) || videoDuration <= 0 || containerWidth <= 0) return originalTime;
    if (originalTime > videoDuration) return originalTime;

    const ratio = Math.min(1, (containerWidth / 1024) * 1.25);
    const fontSize = DANMAKU_FONT_SIZE * ratio * (comment.size === 'big' ? 1.25 : comment.size === 'small' ? 0.8 : 1);
    const textWidth = measureDanmakuWidth(comment.text, fontSize);
    if (textWidth <= 0) return originalTime;

    // DPlayer starts a scrolling comment just outside the right edge. Move a
    // late comment forward by the time needed for its full bitmap to enter the
    // player before playback reaches the end.
    const bitmapPadding = Math.ceil(Math.max(4, fontSize * 0.1));
    const enterDuration = (DANMAKU_MAX_DURATION_SECONDS * (textWidth + bitmapPadding)) / (containerWidth + textWidth);
    return Math.min(originalTime, Math.max(0, videoDuration - enterDuration));
}

function measureDanmakuWidth(text: string, fontSize: number): number {
    measureContext ??= document.createElement('canvas').getContext('2d');
    if (measureContext === null) return 0;
    measureContext.font = `bold ${fontSize}px "Segoe UI", Arial`;
    return text.split('\n').reduce((maximum, line) => Math.max(maximum, measureContext?.measureText(line).width ?? 0), 0);
}
