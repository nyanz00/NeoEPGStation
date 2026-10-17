import { activeAssEvents, clearAssSubtitleMeasurements, drawAssSubtitles, parseAssSubtitle, type AssSubtitleDocument } from './CanvasSubtitleLayout';
import { getSubtitleFontFamily } from './subtitleFont';

const MEDIA_EVENTS = ['loadedmetadata', 'timeupdate', 'seeking', 'seeked', 'play', 'pause', 'ended', 'emptied'] as const;

export class CanvasSubtitleRenderer {
    private video: HTMLVideoElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private document: AssSubtitleDocument | null = null;
    private observer: ResizeObserver | null = null;
    private frame: number | null = null;
    private isNicoJk = false;
    private positioned = false;
    private lastKey = '';

    public async setSubtitle(video: HTMLVideoElement, text: string, isNicoJk: boolean): Promise<void> {
        const document = parseAssSubtitle(text);
        if (this.video !== video || this.canvas?.parentElement !== video.parentElement) {
            this.clear();
            const parent = video.parentElement;
            if (parent === null) return;
            const canvas = window.document.createElement('canvas');
            canvas.className = 'neo-player-ass-canvas';
            canvas.setAttribute('aria-hidden', 'true');
            Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none', zIndex: '3' });
            parent.appendChild(canvas);
            this.video = video;
            this.canvas = canvas;
            this.observer = new ResizeObserver(this.invalidate);
            this.observer.observe(video);
            this.observer.observe(parent);
            for (const event of MEDIA_EVENTS) video.addEventListener(event, this.handleMediaEvent);
            window.addEventListener('resize', this.invalidate);
            window.document.fonts?.addEventListener('loadingdone', this.handleFontsLoaded);
        }
        this.document = document;
        this.positioned = document.events.some(event => event.position || event.move);
        this.isNicoJk = isNicoJk;
        this.invalidate();
        this.schedule();
    }

    public clear(): void {
        if (this.frame !== null) window.cancelAnimationFrame(this.frame);
        this.frame = null;
        this.observer?.disconnect();
        this.observer = null;
        if (this.video) for (const event of MEDIA_EVENTS) this.video.removeEventListener(event, this.handleMediaEvent);
        window.removeEventListener('resize', this.invalidate);
        window.document.fonts?.removeEventListener('loadingdone', this.handleFontsLoaded);
        this.canvas?.remove();
        this.canvas = null;
        this.video = null;
        this.document = null;
        this.lastKey = '';
    }

    public destroy(): void {
        this.clear();
    }

    private readonly invalidate = (): void => {
        this.lastKey = '';
        this.draw();
    };

    private readonly handleFontsLoaded = (): void => {
        clearAssSubtitleMeasurements();
        this.invalidate();
    };

    private readonly handleMediaEvent = (): void => {
        this.invalidate();
        this.schedule();
    };

    private schedule(): void {
        if (this.frame === null && this.video && !this.video.paused && !this.video.ended) this.frame = window.requestAnimationFrame(this.tick);
    }

    private readonly tick = (): void => {
        this.frame = null;
        this.draw();
        this.schedule();
    };

    private draw(): void {
        const video = this.video;
        const canvas = this.canvas;
        const doc = this.document;
        if (!video || !canvas || !doc) return;
        const parent = video.parentElement;
        if (!parent) return;
        // Match object-fit:contain inside the video element, excluding letterboxes.
        // offset/client dimensions stay in CSS pixels even in DPlayer's scaled mode.
        const videoWidth = video.videoWidth || doc.width;
        const videoHeight = video.videoHeight || doc.height;
        const scale = Math.min(video.clientWidth / videoWidth, video.clientHeight / videoHeight);
        const width = videoWidth * scale;
        const height = videoHeight * scale;
        if (width <= 0 || height <= 0) return;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, 4096 / width, 4096 / height);
        const w = Math.max(1, Math.round(width * pixelRatio));
        const h = Math.max(1, Math.round(height * pixelRatio));
        const sizeChanged = canvas.width !== w || canvas.height !== h;
        if (sizeChanged) {
            canvas.width = w;
            canvas.height = h;
        }
        Object.assign(canvas.style, {
            left: `${video.offsetLeft + (video.clientWidth - width) / 2}px`,
            top: `${video.offsetTop + (video.clientHeight - height) / 2}px`,
            width: `${width}px`,
            height: `${height}px`,
        });
        const time = video.currentTime;
        const events = activeAssEvents(doc, time);
        // Static captions are only repainted at event boundaries. Moving comments
        // and fades follow the media clock, including seeks and playbackRate.
        const animated = events.some(event => event.move || event.fade);
        const key = video.readyState < 1 ? 'empty' : `${events.map(event => event.order).join(',')}:${animated ? time : ''}`;
        if (!sizeChanged && key === this.lastKey) return;
        this.lastKey = key;
        const context = canvas.getContext('2d');
        if (context === null) return;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, w, h);
        if (key === 'empty') return;
        // FFmpeg assigns SRT a generic 384x288 script plane regardless of the
        // movie's aspect ratio. Reflow unpositioned text on a square-pixel plane
        // so a 16:9 movie does not stretch its letters horizontally. Absolute
        // Amatsukaze/NicoJK coordinates retain their original script plane.
        const drawingDocument = this.positioned ? doc : { ...doc, width: (doc.height * videoWidth) / videoHeight };
        context.scale(w / drawingDocument.width, h / drawingDocument.height);
        drawAssSubtitles(context, drawingDocument, time, this.isNicoJk, getSubtitleFontFamily());
    }
}
