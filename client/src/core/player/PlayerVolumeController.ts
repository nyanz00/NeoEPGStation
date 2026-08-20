import { getStoredPlayerVolumePercent, setStoredPlayerMuted, setStoredPlayerVolumePercent } from '../storage/player';
import { updateDPlayerVolumePercent } from './DPlayerUi';

const STANDARD_MAX_VOLUME_PERCENT = 100;

interface AudioContextWindow extends Window {
    webkitAudioContext?: typeof AudioContext;
}

export interface PlayerVolumeControllerOption {
    container: HTMLElement;
    video: HTMLVideoElement;
    boostEnabled: boolean;
    boostMaxPercent: number;
    onError?: (error: unknown) => void;
}

export class PlayerVolumeController {
    private readonly option: PlayerVolumeControllerOption;
    private readonly maximumPercent: number;
    private volumePercent: number;
    private audioContext: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private dragging = false;
    private applying = false;
    private destroyed = false;

    constructor(option: PlayerVolumeControllerOption) {
        this.option = option;
        this.maximumPercent = option.boostEnabled ? Math.min(200, Math.max(STANDARD_MAX_VOLUME_PERCENT, Math.round(option.boostMaxPercent))) : STANDARD_MAX_VOLUME_PERCENT;
        this.volumePercent = getStoredPlayerVolumePercent(this.maximumPercent);
        this.bindEvents();
        this.applyVolume(false);
    }

    public activateAudio(): void {
        if (this.volumePercent <= STANDARD_MAX_VOLUME_PERCENT || this.destroyed) return;
        this.ensureAudioGraph();
    }

    public destroy(): void {
        this.destroyed = true;
        this.stopDragging();
        this.option.container.removeEventListener('pointerdown', this.handleActivation, true);
        this.option.container.removeEventListener('keydown', this.handleActivation, true);
        this.option.video.removeEventListener('volumechange', this.handleNativeVolumeChange);
        const volumeBar = this.getVolumeBar();
        volumeBar?.removeEventListener('mousedown', this.handleVolumeStart, true);
        volumeBar?.removeEventListener('touchstart', this.handleVolumeStart, true);
        volumeBar?.removeEventListener('click', this.handleVolumeClick, true);
        delete this.option.container.dataset.neoPlayerVolumePercent;
        if (this.audioContext !== null) void this.audioContext.close().catch(() => {});
        this.audioContext = null;
        this.gainNode = null;
    }

    private readonly handleActivation = (): void => this.activateAudio();

    private readonly handleNativeVolumeChange = (): void => {
        if (this.applying) return;
        if (this.option.video.volume < 1 || !this.option.boostEnabled) {
            this.volumePercent = Math.round(this.option.video.volume * STANDARD_MAX_VOLUME_PERCENT);
            setStoredPlayerVolumePercent(this.volumePercent);
            if (this.gainNode !== null) this.gainNode.gain.value = 1;
        }
        setStoredPlayerMuted(this.option.video.muted);
        window.queueMicrotask(() => this.syncUi());
    };

    private readonly handleVolumeStart = (event: Event): void => {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.dragging = true;
        this.setVolumeFromPointer(event);
        document.addEventListener('mousemove', this.handleVolumeMove, true);
        document.addEventListener('mouseup', this.handleVolumeEnd, true);
        document.addEventListener('touchmove', this.handleVolumeMove, { capture: true, passive: false });
        document.addEventListener('touchend', this.handleVolumeEnd, true);
        document.addEventListener('touchcancel', this.handleVolumeEnd, true);
    };

    private readonly handleVolumeClick = (event: Event): void => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    private readonly handleVolumeMove = (event: Event): void => {
        if (!this.dragging) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.setVolumeFromPointer(event);
    };

    private readonly handleVolumeEnd = (event: Event): void => {
        if (!this.dragging) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.setVolumeFromPointer(event);
        this.stopDragging();
    };

    private bindEvents(): void {
        this.option.container.addEventListener('pointerdown', this.handleActivation, true);
        this.option.container.addEventListener('keydown', this.handleActivation, true);
        this.option.video.addEventListener('volumechange', this.handleNativeVolumeChange);
        if (!this.option.boostEnabled) return;
        const volumeBar = this.getVolumeBar();
        volumeBar?.addEventListener('mousedown', this.handleVolumeStart, true);
        volumeBar?.addEventListener('touchstart', this.handleVolumeStart, { capture: true, passive: false });
        volumeBar?.addEventListener('click', this.handleVolumeClick, true);
    }

    private getVolumeBar(): HTMLElement | null {
        return this.option.container.querySelector<HTMLElement>('.dplayer-volume-bar-wrap');
    }

    private setVolumeFromPointer(event: Event): void {
        const bar = this.getVolumeBar()?.querySelector<HTMLElement>('.dplayer-volume-bar');
        if (bar === null || bar === undefined) return;
        const point = event instanceof TouchEvent ? (event.touches[0] ?? event.changedTouches[0]) : (event as MouseEvent);
        if (point === undefined) return;
        const bounds = bar.getBoundingClientRect();
        const ratio = bounds.width <= 0 ? 0 : Math.min(1, Math.max(0, (point.clientX - bounds.left) / bounds.width));
        this.volumePercent = Math.round(ratio * this.maximumPercent);
        if (this.volumePercent > STANDARD_MAX_VOLUME_PERCENT) this.ensureAudioGraph();
        this.option.video.muted = false;
        this.applyVolume(true);
    }

    private applyVolume(persist: boolean): void {
        this.applying = true;
        this.option.video.volume = Math.min(1, this.volumePercent / STANDARD_MAX_VOLUME_PERCENT);
        if (this.gainNode !== null) this.gainNode.gain.value = Math.max(1, this.volumePercent / STANDARD_MAX_VOLUME_PERCENT);
        this.applying = false;
        if (persist) {
            setStoredPlayerVolumePercent(this.volumePercent);
            setStoredPlayerMuted(this.option.video.muted);
        }
        this.syncUi();
    }

    private syncUi(): void {
        if (this.destroyed) return;
        this.option.container.dataset.neoPlayerVolumePercent = this.volumePercent.toString(10);
        const barInner = this.option.container.querySelector<HTMLElement>('.dplayer-volume-bar-inner');
        if (barInner !== null) barInner.style.width = `${((this.option.video.muted ? 0 : this.volumePercent) / this.maximumPercent) * 100}%`;
        const barWrap = this.getVolumeBar();
        if (barWrap !== null) barWrap.setAttribute('aria-label', `${this.option.video.muted ? 0 : this.volumePercent}%`);
        updateDPlayerVolumePercent(this.option.container);
    }

    private ensureAudioGraph(): void {
        if (this.gainNode !== null) {
            void this.audioContext?.resume().catch(error => this.option.onError?.(error));
            return;
        }
        const AudioContextConstructor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext;
        if (AudioContextConstructor === undefined) {
            this.fallbackToStandardVolume(new Error('Web Audio API is not supported'));
            return;
        }
        try {
            const audioContext = new AudioContextConstructor();
            const source = audioContext.createMediaElementSource(this.option.video);
            const gainNode = audioContext.createGain();
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);
            this.audioContext = audioContext;
            this.gainNode = gainNode;
            gainNode.gain.value = this.volumePercent / STANDARD_MAX_VOLUME_PERCENT;
            void audioContext.resume().catch(error => this.option.onError?.(error));
        } catch (error) {
            this.fallbackToStandardVolume(error);
        }
    }

    private fallbackToStandardVolume(error: unknown): void {
        this.option.onError?.(error);
        this.volumePercent = Math.min(STANDARD_MAX_VOLUME_PERCENT, this.volumePercent);
        if (this.gainNode !== null) this.gainNode.gain.value = 1;
        this.applyVolume(true);
    }

    private stopDragging(): void {
        this.dragging = false;
        document.removeEventListener('mousemove', this.handleVolumeMove, true);
        document.removeEventListener('mouseup', this.handleVolumeEnd, true);
        document.removeEventListener('touchmove', this.handleVolumeMove, true);
        document.removeEventListener('touchend', this.handleVolumeEnd, true);
        document.removeEventListener('touchcancel', this.handleVolumeEnd, true);
    }
}
