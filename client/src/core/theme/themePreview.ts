import { useSyncExternalStore } from 'react';
import type { AppThemePresetId } from './themePresets';

export interface AppThemePreview {
    shouldUseOSColorTheme: boolean;
    isForceDarkTheme: boolean;
    themeColorPreset: AppThemePresetId;
    customThemeColor: string;
    isEmphasizeLightThemeEdges: boolean;
}

let preview: AppThemePreview | null = null;
const listeners = new Set<() => void>();

export const themePreviewStore = {
    getSnapshot: (): AppThemePreview | null => preview,
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    set(value: AppThemePreview): void {
        preview = value;
        listeners.forEach(listener => listener());
    },
    clear(): void {
        preview = null;
        listeners.forEach(listener => listener());
    },
};

export function useThemePreview(): AppThemePreview | null {
    return useSyncExternalStore(themePreviewStore.subscribe, themePreviewStore.getSnapshot);
}
