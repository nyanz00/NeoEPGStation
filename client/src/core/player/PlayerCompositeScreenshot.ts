export const DPLAYER_COMPOSITE_SCREENSHOT_CONTROL_NAME = 'composite-screenshot';
export const DPLAYER_COMPOSITE_SCREENSHOT_ICON =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M21 6h-3.2L16 4h-6v2h5.1L17 8h4v12H5v-9H3v9c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2M8 14c0 4.45 5.39 6.69 8.54 3.54S17.45 9 13 9c-2.76 0-5 2.24-5 5m5-3c1.64.05 2.95 1.36 3 3-.05 1.64-1.36 2.95-3 3-1.64-.05-2.95-1.36-3-3 .05-1.64 1.36-2.95 3-3M5 6h3V4H5V1H3v3H0v2h3v3h2"/></svg>';

interface DanmakuCanvasItem {
    x: number;
    y: number;
    bitmap: HTMLCanvasElement;
    bitmapWidth: number;
    bitmapHeight: number;
    bitmapPadding: number;
}

export interface CompositeScreenshotDanmaku {
    canvasItems?: Iterable<DanmakuCanvasItem>;
}

export interface CompositeScreenshotOption {
    container: HTMLElement;
    video: HTMLVideoElement;
    danmaku?: CompositeScreenshotDanmaku | null;
}

const MAX_CAPTURE_DIMENSION = 4_096;

interface CaptureRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

function isVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0;
}

function drawCanvasLayer(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, captureRect: CaptureRect, scale: number): void {
    if (!isVisible(canvas) || canvas.width <= 0 || canvas.height <= 0) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    context.drawImage(canvas, (rect.left - captureRect.left) * scale, (rect.top - captureRect.top) * scale, rect.width * scale, rect.height * scale);
}

function drawDanmaku(
    context: CanvasRenderingContext2D,
    captureRect: CaptureRect,
    scale: number,
    container: HTMLElement,
    danmaku: CompositeScreenshotDanmaku | null | undefined,
): void {
    const layer = container.querySelector<HTMLElement>('.dplayer-danmaku');
    if (layer === null || !isVisible(layer) || danmaku?.canvasItems === undefined) return;
    const layerRect = layer.getBoundingClientRect();
    const opacityValue = window.getComputedStyle(layer).getPropertyValue('--dplayer-danmaku-opacity');
    const opacity = Number.parseFloat(opacityValue);
    context.save();
    context.globalAlpha = Number.isFinite(opacity) ? opacity : 1;
    for (const item of danmaku.canvasItems) {
        if (item.bitmap.width <= 0 || item.bitmap.height <= 0) continue;
        const left = layerRect.left - captureRect.left + item.x - item.bitmapPadding;
        // A comment bitmap includes its own outline padding. Keep that padding
        // and its lane origin inside the captured video instead of clipping it.
        const layerTop = Math.max(0, layerRect.top - captureRect.top);
        const top = Math.max(0, layerTop + item.y - item.bitmapPadding);
        context.drawImage(item.bitmap, left * scale, top * scale, item.bitmapWidth * scale, item.bitmapHeight * scale);
    }
    context.restore();
}

function drawWebVttSubtitle(context: CanvasRenderingContext2D, container: HTMLElement, captureRect: CaptureRect, scale: number): void {
    const subtitle = container.querySelector<HTMLElement>('.dplayer-subtitle');
    const text = subtitle?.textContent?.trim();
    if (subtitle === null || subtitle === undefined || text === undefined || text.length === 0 || !isVisible(subtitle)) return;
    const rect = subtitle.getBoundingClientRect();
    const style = window.getComputedStyle(subtitle);
    const fontSize = Number.parseFloat(style.fontSize) * scale;
    const lineHeightValue = Number.parseFloat(style.lineHeight);
    const lineHeight = (Number.isFinite(lineHeightValue) ? lineHeightValue : Number.parseFloat(style.fontSize) * 1.2) * scale;
    const lines = Array.from(subtitle.querySelectorAll('p')).map(line => line.textContent ?? '');
    if (lines.length === 0) lines.push(...text.split(/\r?\n/));

    context.save();
    context.font = `${style.fontWeight} ${fontSize.toString()}px ${style.fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(2, fontSize * 0.08);
    context.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    context.fillStyle = style.color || '#fff';
    const x = (rect.left - captureRect.left + rect.width / 2) * scale;
    const startY = (rect.top - captureRect.top) * scale;
    lines.forEach((line, index) => {
        const y = startY + index * lineHeight;
        context.strokeText(line, x, y);
        context.fillText(line, x, y);
    });
    context.restore();
}

function createFilename(): string {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return `Capture_Overlays_${timestamp}.png`;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob === null) {
                reject(new Error('スクリーンショット画像を作成できませんでした。'));
                return;
            }
            resolve(blob);
        }, 'image/png');
    });
}

export async function downloadCompositeScreenshot(option: CompositeScreenshotOption): Promise<void> {
    const { container, video, danmaku } = option;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
        throw new Error('映像が表示されてからスクリーンショットを撮影してください。');
    }

    const root = container.querySelector<HTMLElement>('.dplayer-video-wrap-aspect');
    if (root === null) throw new Error('スクリーンショットの描画領域が見つかりません。');
    const videoRect = video.getBoundingClientRect();
    if (videoRect.width <= 0 || videoRect.height <= 0) {
        throw new Error('スクリーンショットの描画領域を取得できません。');
    }

    const displayScale = Math.min(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight);
    const videoWidth = video.videoWidth * displayScale;
    const videoHeight = video.videoHeight * displayScale;
    const captureRect: CaptureRect = {
        left: videoRect.left + (videoRect.width - videoWidth) / 2,
        top: videoRect.top + (videoRect.height - videoHeight) / 2,
        width: videoWidth,
        height: videoHeight,
    };
    const nativeScale = 1 / displayScale;
    const scale = Math.min(nativeScale, MAX_CAPTURE_DIMENSION / captureRect.width, MAX_CAPTURE_DIMENSION / captureRect.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(captureRect.width * scale));
    canvas.height = Math.max(1, Math.round(captureRect.height * scale));
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('スクリーンショット用Canvasを初期化できませんでした。');

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawDanmaku(context, captureRect, scale, container, danmaku);

    const subtitleCanvases = [
        ...Array.from(root.children).filter((element): element is HTMLCanvasElement => element instanceof HTMLCanvasElement),
        ...Array.from(root.querySelectorAll<HTMLCanvasElement>('.JASSUB canvas')),
    ];
    const drawnCanvases = new Set<HTMLCanvasElement>();
    for (const subtitleCanvas of subtitleCanvases) {
        if (drawnCanvases.has(subtitleCanvas)) continue;
        drawnCanvases.add(subtitleCanvas);
        drawCanvasLayer(context, subtitleCanvas, captureRect, scale);
    }
    drawWebVttSubtitle(context, container, captureRect, scale);

    const blob = await canvasToBlob(canvas);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = createFilename();
    link.href = url;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
