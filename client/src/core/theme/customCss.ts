import { useSyncExternalStore } from 'react';

export function isCustomCssDisabledByUrl(): boolean {
    if (new URLSearchParams(window.location.search).get('disable-custom-css') === '1') return true;
    const hashQueryIndex = window.location.hash.indexOf('?');
    return hashQueryIndex >= 0 && new URLSearchParams(window.location.hash.slice(hashQueryIndex + 1)).get('disable-custom-css') === '1';
}

export interface CustomCssPreview {
    enabled: boolean;
    css: string;
}

let preview: CustomCssPreview | null = null;
const previewListeners = new Set<() => void>();

export const customCssPreviewStore = {
    getSnapshot: (): CustomCssPreview | null => preview,
    subscribe(listener: () => void): () => void {
        previewListeners.add(listener);
        return () => previewListeners.delete(listener);
    },
    set(value: CustomCssPreview): void {
        preview = value;
        previewListeners.forEach(listener => listener());
    },
    clear(): void {
        preview = null;
        previewListeners.forEach(listener => listener());
    },
};

export function useCustomCssPreview(): CustomCssPreview | null {
    return useSyncExternalStore(customCssPreviewStore.subscribe, customCssPreviewStore.getSnapshot);
}
