import modernWasmUrl from 'jassub/dist/jassub-worker-modern.wasm?url';
import workerUrl from 'jassub/dist/jassub-worker.js?url';
import legacyWasmUrl from 'jassub/dist/jassub-worker.wasm.js?url';
import wasmUrl from 'jassub/dist/jassub-worker.wasm?url';
import { withBasePath } from '../path';
import { preprocessAssSubtitle } from './AssSubtitlePreprocessor';

type JASSUBInstance = import('jassub').default;

interface JassubFontData {
    bold: Uint8Array;
    symbols: Uint8Array;
}

let fontDataPromise: Promise<JassubFontData> | null = null;

async function fetchFont(path: string): Promise<Uint8Array> {
    const response = await fetch(withBasePath(path));
    if (!response.ok) throw new Error(`JASSUBFontRequestFailed: ${response.status.toString(10)}`);
    return new Uint8Array(await response.arrayBuffer());
}

async function loadFontData(): Promise<JassubFontData> {
    fontDataPromise ??= Promise.all([fetchFont('/fonts/noto-sans-jp-bold.ttf'), fetchFont('/fonts/noto-sans-symbols-2-regular.ttf')]).then(([bold, symbols]) => ({
        bold,
        symbols,
    }));
    return fontDataPromise;
}

export class JassubSubtitleRenderer {
    private instance: JASSUBInstance | null = null;
    private video: HTMLVideoElement | null = null;
    private isNicoJk = false;
    private generation = 0;

    public async setSubtitle(video: HTMLVideoElement, subtitleText: string, isNicoJk: boolean): Promise<void> {
        const generation = ++this.generation;
        const processedSubtitle = preprocessAssSubtitle(subtitleText, { isNicoJk });
        if (this.instance !== null && this.video === video && this.isNicoJk === isNicoJk) {
            this.instance.setTrack(processedSubtitle);

            return;
        }
        this.destroyInstance();
        const [JASSUB, fontData] = await Promise.all([import('jassub').then(module => module.default), loadFontData()]);
        if (generation !== this.generation) return;
        this.instance = new JASSUB({
            video,
            subContent: processedSubtitle,
            workerUrl,
            wasmUrl,
            legacyWasmUrl,
            modernWasmUrl,
            fonts: [fontData.bold, fontData.symbols],
            availableFonts: {
                arial: fontData.bold,
                'liberation sans': fontData.bold,
                meiryo: fontData.bold,
                'ms gothic': fontData.bold,
                'ms pgothic': fontData.bold,
                'noto sans cjk jp': fontData.bold,
                'noto sans jp': fontData.bold,
                'noto sans jp thin': fontData.bold,
                'noto sans symbols 2': fontData.symbols,
                'yu gothic': fontData.bold,
                'yu gothic medium': fontData.bold,
            } as any,
            fallbackFont: 'noto sans jp',
            useLocalFonts: false,
            // Keep the visible subtitle canvas readable so the player can
            // composite ASS/SRT subtitles into overlay screenshots.
            offscreenRender: false,
            onDemandRender: !isNicoJk,
            targetFps: isNicoJk ? 60 : 24,
        } as any);
        this.video = video;
        this.isNicoJk = isNicoJk;
    }

    public clear(): void {
        this.generation++;
        this.destroyInstance();
    }

    public destroy(): void {
        this.clear();
    }

    private destroyInstance(): void {
        this.instance?.destroy();
        this.instance = null;
        this.video = null;
    }
}
