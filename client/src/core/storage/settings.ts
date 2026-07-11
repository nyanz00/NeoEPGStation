import { useSyncExternalStore } from 'react';

export type GuideViewMode = 'sequential' | 'minimum' | 'all';
export type WatchStreamEncoderSetting = 'Config' | 'FFmpeg' | 'QSVEncC' | 'NVEncC' | 'VCEEncC';

export interface AppSettings {
    isEnablePWA: boolean;
    shouldUseOSColorTheme: boolean;
    isForceDarkTheme: boolean;
    isHalfWidthDisplayed: boolean;
    isOnAirTabListView: boolean;
    isPreferredPlayingLiveM2TSOnWeb: boolean;
    onAirM2TSViewURLScheme: string | null;
    watchStreamEncoder: WatchStreamEncoderSetting;
    watchDefaultQuality: string | null;
    watchUseHevc: boolean;
    watchLowLatency: boolean;
    watchSubtitlePreferredKeyword: string;
    watchPlaySubtitlePreferredKeyword: string;
    guideMode: GuideViewMode;
    guideLength: number;
    isForceDisableDarkThemeForGuide: boolean;
    isShowOnlyFreePrograms: boolean;
    isEnableDisplayForEachBroadcastWave: boolean;
    isIncludeChannelIdWhenSearching: boolean;
    isIncludeGenreWhenSearching: boolean;
    reservesLength: number;
    recordingLength: number;
    recordedLength: number;
    isShowTableMode: boolean;
    isPreferredPlayingOnWeb: boolean;
    isShowDropInfoInsteadOfDescription: boolean;
    deleteRecordedDefaultValue: boolean;
    shouldUseRecordedViewURLScheme: boolean;
    recordedViewURLScheme: string | null;
    shouldUseRecordedDownloadURLScheme: boolean;
    recordedDownloadURLScheme: string | null;
    searchLength: number;
    isEnableAutoScrollWhenEditingRule: boolean;
    isEnableCopyKeywordToDirectory: boolean;
    isCheckAvoidDuplicate: boolean;
    isEnableEncodingSettingWhenCreateRule: boolean;
    isCheckDeleteOriginalAfterEncode: boolean;
    rulesLength: number;
    isForceEnableSubtitleStroke: boolean;
}

const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isAndroid = /Android/.test(navigator.userAgent);

export const defaultSettings: AppSettings = {
    isEnablePWA: true,
    shouldUseOSColorTheme: true,
    isForceDarkTheme: false,
    isHalfWidthDisplayed: true,
    isOnAirTabListView: true,
    isPreferredPlayingLiveM2TSOnWeb: true,
    onAirM2TSViewURLScheme: null,
    watchStreamEncoder: 'Config',
    watchDefaultQuality: null,
    watchUseHevc: false,
    watchLowLatency: true,
    watchSubtitlePreferredKeyword: '',
    watchPlaySubtitlePreferredKeyword: '',
    guideMode: isAppleMobile ? 'all' : 'sequential',
    guideLength: 24,
    isForceDisableDarkThemeForGuide: false,
    isShowOnlyFreePrograms: false,
    isEnableDisplayForEachBroadcastWave: false,
    isIncludeChannelIdWhenSearching: true,
    isIncludeGenreWhenSearching: true,
    reservesLength: 24,
    recordingLength: 24,
    recordedLength: 24,
    isShowTableMode: false,
    isPreferredPlayingOnWeb: !isAppleMobile && !isAndroid,
    isShowDropInfoInsteadOfDescription: false,
    deleteRecordedDefaultValue: false,
    shouldUseRecordedViewURLScheme: true,
    recordedViewURLScheme: null,
    shouldUseRecordedDownloadURLScheme: true,
    recordedDownloadURLScheme: null,
    searchLength: 300,
    isEnableAutoScrollWhenEditingRule: true,
    isEnableCopyKeywordToDirectory: false,
    isCheckAvoidDuplicate: false,
    isEnableEncodingSettingWhenCreateRule: false,
    isCheckDeleteOriginalAfterEncode: false,
    rulesLength: 24,
    isForceEnableSubtitleStroke: true,
};

function loadSettings(): AppSettings {
    try {
        const saved = localStorage.getItem('settings');
        return saved === null ? defaultSettings : { ...defaultSettings, ...JSON.parse(saved) };
    } catch {
        return defaultSettings;
    }
}

let snapshot = loadSettings();
const listeners = new Set<() => void>();

export const settingsStore = {
    getSnapshot: (): AppSettings => snapshot,
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    save(value: AppSettings): void {
        snapshot = value;
        try {
            localStorage.setItem('settings', JSON.stringify(value));
        } catch {
            // The in-memory value remains usable when storage is unavailable.
        }
        listeners.forEach(listener => listener());
    },
};

export function useSettings(): AppSettings {
    return useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
}
