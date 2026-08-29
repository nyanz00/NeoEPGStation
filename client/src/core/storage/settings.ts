import { useSyncExternalStore } from 'react';
import { isAppIconSetId, type AppIconSetId } from '../icons/appIcons';
import { defaultAppThemePresetId, defaultCustomThemeColor, isAppThemePresetId, normalizeCustomThemeColor, type AppThemePresetId } from '../theme/themePresets';
import { defaultSideNavigationOrder, normalizeHiddenSideNavigationItems, normalizeSideNavigationOrder, type SideNavigationItemId } from '../navigation';

export type GuideViewMode = 'sequential' | 'minimum' | 'all';
export type WatchStreamEncoderSetting = 'Config' | 'FFmpeg' | 'QSVEncC' | 'NVEncC' | 'VCEEncC';
export type WebKitPlaybackMode = 'standard' | 'ios26';
export type WatchDanmakuFrameRateLimit = 'auto' | '60' | '72' | '120' | '144';
export type AnnictAutoWatchMode = 'disabled' | 'start' | 'progress';

export interface AppSettings {
    isEnablePWA: boolean;
    appIconSet: AppIconSetId;
    isAppLogoLinkedToIcon: boolean;
    isAppLogoHidden: boolean;
    shouldUseOSColorTheme: boolean;
    isForceDarkTheme: boolean;
    themeColorPreset: AppThemePresetId;
    customThemeColor: string;
    isCustomCssEnabled: boolean;
    customCss: string;
    isEmphasizeLightThemeEdges: boolean;
    isHalfWidthDisplayed: boolean;
    isShowVersionUpdateNotification: boolean;
    sideNavigationOrder: SideNavigationItemId[];
    hiddenSideNavigationItems: SideNavigationItemId[];
    isOnAirTabListView: boolean;
    isPreferredPlayingLiveM2TSOnWeb: boolean;
    onAirM2TSViewURLScheme: string | null;
    watchStreamEncoder: WatchStreamEncoderSetting;
    watchDefaultQuality: string | null;
    watchUseHevc: boolean;
    webkitPlaybackMode: WebKitPlaybackMode;
    watchLowLatency: boolean;
    watchStreamingBufferedStart: boolean;
    watchSubtitlePreferredKeywords: string[];
    watchStreamingSubtitleSizePercent: number;
    watchStreamingSubtitleOpacityPercent: number;
    watchStreamingSubtitleOutlineSizePercent: number;
    watchStreamingSubtitleOutlineOpacityPercent: number;
    watchPlaySubtitleDanmaku: boolean;
    watchDanmakuHighRefreshRate: boolean;
    watchDanmakuFrameRateLimit: WatchDanmakuFrameRateLimit;
    watchPersistentBottomControls: boolean;
    watchShowVolumePercent: boolean;
    watchVolumeBoostEnabled: boolean;
    watchVolumeBoostMaxPercent: number;
    watchResumePlayback: boolean;
    watchHistoryLength: number;
    annictAutoWatchMode: AnnictAutoWatchMode;
    annictAutoWatchThresholdPercent: number;
    annictAutoWatchOnDownload: boolean;
    annictStopWatchingOnRuleDisable: boolean;
    annictMarkWatchedOnFinalEpisode: boolean;
    annictDisableRulesOnFinalEpisode: boolean;
    annictSupplementalChannelIds: number[];
    guideMode: GuideViewMode;
    guideLength: number;
    isForceDisableDarkThemeForGuide: boolean;
    isShowOnlyFreePrograms: boolean;
    isShowInformationalChannels: boolean;
    isEnableDisplayForEachBroadcastWave: boolean;
    isIncludeChannelIdWhenSearching: boolean;
    isIncludeGenreWhenSearching: boolean;
    reservesLength: number;
    recordingLength: number;
    recordedLength: number;
    isShowTableMode: boolean;
    isHighlightRecordedOnReturn: boolean;
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
    appIconSet: 'neo',
    isAppLogoLinkedToIcon: false,
    isAppLogoHidden: false,
    shouldUseOSColorTheme: true,
    isForceDarkTheme: false,
    themeColorPreset: defaultAppThemePresetId,
    customThemeColor: defaultCustomThemeColor,
    isCustomCssEnabled: false,
    customCss: '',
    isEmphasizeLightThemeEdges: true,
    isHalfWidthDisplayed: true,
    isShowVersionUpdateNotification: true,
    sideNavigationOrder: [...defaultSideNavigationOrder],
    hiddenSideNavigationItems: [],
    isOnAirTabListView: true,
    isPreferredPlayingLiveM2TSOnWeb: true,
    onAirM2TSViewURLScheme: null,
    watchStreamEncoder: 'Config',
    watchDefaultQuality: null,
    watchUseHevc: false,
    webkitPlaybackMode: 'standard',
    watchLowLatency: true,
    watchStreamingBufferedStart: false,
    watchSubtitlePreferredKeywords: ['', '', ''],
    watchStreamingSubtitleSizePercent: 100,
    watchStreamingSubtitleOpacityPercent: 100,
    watchStreamingSubtitleOutlineSizePercent: 100,
    watchStreamingSubtitleOutlineOpacityPercent: 100,
    watchPlaySubtitleDanmaku: false,
    watchDanmakuHighRefreshRate: false,
    watchDanmakuFrameRateLimit: 'auto',
    watchPersistentBottomControls: false,
    watchShowVolumePercent: true,
    watchVolumeBoostEnabled: false,
    watchVolumeBoostMaxPercent: 150,
    watchResumePlayback: true,
    watchHistoryLength: 50,
    annictAutoWatchMode: 'disabled',
    annictAutoWatchThresholdPercent: 90,
    annictAutoWatchOnDownload: false,
    annictStopWatchingOnRuleDisable: true,
    annictMarkWatchedOnFinalEpisode: true,
    annictDisableRulesOnFinalEpisode: true,
    annictSupplementalChannelIds: [],
    guideMode: isAppleMobile ? 'all' : 'sequential',
    guideLength: 24,
    isForceDisableDarkThemeForGuide: false,
    isShowOnlyFreePrograms: false,
    isShowInformationalChannels: false,
    isEnableDisplayForEachBroadcastWave: false,
    isIncludeChannelIdWhenSearching: true,
    isIncludeGenreWhenSearching: true,
    reservesLength: 24,
    recordingLength: 24,
    recordedLength: 24,
    isShowTableMode: false,
    isHighlightRecordedOnReturn: true,
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
        const parsed =
            saved === null
                ? {}
                : (JSON.parse(saved) as Partial<AppSettings> & {
                      watchSubtitlePreferredKeyword?: unknown;
                      watchPlaySubtitlePreferredKeyword?: unknown;
                  });
        let showInformationalChannels = parsed.isShowInformationalChannels;
        if (typeof showInformationalChannels !== 'boolean') {
            try {
                const legacy = JSON.parse(localStorage.getItem('GuideChannelDisplaySetting') ?? 'null') as { showInformationalChannels?: unknown } | null;
                showInformationalChannels = legacy?.showInformationalChannels === true;
            } catch {
                showInformationalChannels = false;
            }
        }
        const annictAutoWatchMode: AnnictAutoWatchMode = ['disabled', 'start', 'progress'].includes(String(parsed.annictAutoWatchMode))
            ? (parsed.annictAutoWatchMode as AnnictAutoWatchMode)
            : defaultSettings.annictAutoWatchMode;
        const threshold = Number(parsed.annictAutoWatchThresholdPercent);
        const historyLength = Number(parsed.watchHistoryLength);
        return {
            ...defaultSettings,
            ...parsed,
            appIconSet: isAppIconSetId(parsed.appIconSet) ? parsed.appIconSet : defaultSettings.appIconSet,
            isAppLogoLinkedToIcon: parsed.isAppLogoLinkedToIcon === true,
            isAppLogoHidden: parsed.isAppLogoHidden === true,
            themeColorPreset: isAppThemePresetId(parsed.themeColorPreset) ? parsed.themeColorPreset : defaultSettings.themeColorPreset,
            customThemeColor: normalizeCustomThemeColor(parsed.customThemeColor),
            isCustomCssEnabled: parsed.isCustomCssEnabled === true,
            customCss: typeof parsed.customCss === 'string' ? parsed.customCss : '',
            isShowInformationalChannels: showInformationalChannels,
            isShowVersionUpdateNotification: parsed.isShowVersionUpdateNotification !== false,
            sideNavigationOrder: normalizeSideNavigationOrder(parsed.sideNavigationOrder),
            hiddenSideNavigationItems: normalizeHiddenSideNavigationItems(parsed.hiddenSideNavigationItems),
            watchSubtitlePreferredKeywords: normalizeSubtitlePreferredKeywords(
                parsed.watchSubtitlePreferredKeywords,
                parsed.watchSubtitlePreferredKeyword,
                parsed.watchPlaySubtitlePreferredKeyword,
            ),
            watchStreamingSubtitleSizePercent: normalizePercent(parsed.watchStreamingSubtitleSizePercent, 50, 250, 100),
            watchStreamingSubtitleOpacityPercent: normalizePercent(parsed.watchStreamingSubtitleOpacityPercent, 10, 300, 100),
            watchStreamingSubtitleOutlineSizePercent: normalizePercent(parsed.watchStreamingSubtitleOutlineSizePercent, 0, 300, 100),
            watchStreamingSubtitleOutlineOpacityPercent: normalizePercent(parsed.watchStreamingSubtitleOutlineOpacityPercent, 0, 300, 100),
            watchPlaySubtitleDanmaku: parsed.watchPlaySubtitleDanmaku === true,
            watchDanmakuHighRefreshRate: parsed.watchDanmakuHighRefreshRate === true,
            watchDanmakuFrameRateLimit: normalizeDanmakuFrameRateLimit(parsed.watchDanmakuFrameRateLimit),
            watchPersistentBottomControls: parsed.watchPersistentBottomControls === true,
            watchShowVolumePercent: parsed.watchShowVolumePercent !== false,
            watchVolumeBoostEnabled: parsed.watchVolumeBoostEnabled === true,
            watchVolumeBoostMaxPercent: normalizePercent(parsed.watchVolumeBoostMaxPercent, 100, 200, 150),
            isHighlightRecordedOnReturn: parsed.isHighlightRecordedOnReturn !== false,
            webkitPlaybackMode: parsed.webkitPlaybackMode === 'ios26' ? 'ios26' : 'standard',
            annictSupplementalChannelIds: normalizeChannelIds(parsed.annictSupplementalChannelIds),
            annictAutoWatchMode,
            annictAutoWatchThresholdPercent:
                Number.isFinite(threshold) && threshold >= 1 && threshold <= 100 ? Math.round(threshold) : defaultSettings.annictAutoWatchThresholdPercent,
            watchHistoryLength: Number.isInteger(historyLength) && historyLength >= 1 && historyLength <= 200 ? historyLength : defaultSettings.watchHistoryLength,
            reservesLength: normalizeListLength(parsed.reservesLength, defaultSettings.reservesLength, 1_000),
            recordingLength: normalizeListLength(parsed.recordingLength, defaultSettings.recordingLength, 1_000),
            recordedLength: normalizeListLength(parsed.recordedLength, defaultSettings.recordedLength, 1_000),
            searchLength: normalizeListLength(parsed.searchLength, defaultSettings.searchLength, 10_000),
            rulesLength: normalizeListLength(parsed.rulesLength, defaultSettings.rulesLength, 1_000),
        };
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
        const threshold = Number(value.annictAutoWatchThresholdPercent);
        const historyLength = Number(value.watchHistoryLength);
        snapshot = {
            ...value,
            appIconSet: isAppIconSetId(value.appIconSet) ? value.appIconSet : defaultSettings.appIconSet,
            isAppLogoLinkedToIcon: value.isAppLogoLinkedToIcon === true,
            isAppLogoHidden: value.isAppLogoHidden === true,
            themeColorPreset: isAppThemePresetId(value.themeColorPreset) ? value.themeColorPreset : defaultSettings.themeColorPreset,
            customThemeColor: normalizeCustomThemeColor(value.customThemeColor),
            isCustomCssEnabled: value.isCustomCssEnabled === true,
            customCss: typeof value.customCss === 'string' ? value.customCss : '',
            isShowVersionUpdateNotification: value.isShowVersionUpdateNotification !== false,
            sideNavigationOrder: normalizeSideNavigationOrder(value.sideNavigationOrder),
            hiddenSideNavigationItems: normalizeHiddenSideNavigationItems(value.hiddenSideNavigationItems),
            watchSubtitlePreferredKeywords: normalizeSubtitlePreferredKeywords(value.watchSubtitlePreferredKeywords),
            watchStreamingSubtitleSizePercent: normalizePercent(value.watchStreamingSubtitleSizePercent, 50, 250, 100),
            watchStreamingSubtitleOpacityPercent: normalizePercent(value.watchStreamingSubtitleOpacityPercent, 10, 300, 100),
            watchStreamingSubtitleOutlineSizePercent: normalizePercent(value.watchStreamingSubtitleOutlineSizePercent, 0, 300, 100),
            watchStreamingSubtitleOutlineOpacityPercent: normalizePercent(value.watchStreamingSubtitleOutlineOpacityPercent, 0, 300, 100),
            watchPlaySubtitleDanmaku: value.watchPlaySubtitleDanmaku === true,
            watchDanmakuHighRefreshRate: value.watchDanmakuHighRefreshRate === true,
            watchDanmakuFrameRateLimit: normalizeDanmakuFrameRateLimit(value.watchDanmakuFrameRateLimit),
            watchPersistentBottomControls: value.watchPersistentBottomControls === true,
            watchShowVolumePercent: value.watchShowVolumePercent !== false,
            watchVolumeBoostEnabled: value.watchVolumeBoostEnabled === true,
            watchVolumeBoostMaxPercent: normalizePercent(value.watchVolumeBoostMaxPercent, 100, 200, 150),
            isHighlightRecordedOnReturn: value.isHighlightRecordedOnReturn !== false,
            webkitPlaybackMode: value.webkitPlaybackMode === 'ios26' ? 'ios26' : 'standard',
            annictSupplementalChannelIds: normalizeChannelIds(value.annictSupplementalChannelIds),
            annictAutoWatchThresholdPercent:
                Number.isFinite(threshold) && threshold >= 1 && threshold <= 100 ? Math.round(threshold) : defaultSettings.annictAutoWatchThresholdPercent,
            watchHistoryLength: Number.isInteger(historyLength) && historyLength >= 1 && historyLength <= 200 ? historyLength : defaultSettings.watchHistoryLength,
            reservesLength: normalizeListLength(value.reservesLength, defaultSettings.reservesLength, 1_000),
            recordingLength: normalizeListLength(value.recordingLength, defaultSettings.recordingLength, 1_000),
            recordedLength: normalizeListLength(value.recordedLength, defaultSettings.recordedLength, 1_000),
            searchLength: normalizeListLength(value.searchLength, defaultSettings.searchLength, 10_000),
            rulesLength: normalizeListLength(value.rulesLength, defaultSettings.rulesLength, 1_000),
        };
        try {
            localStorage.setItem('settings', JSON.stringify(snapshot));
        } catch {
            // The in-memory value remains usable when storage is unavailable.
        }
        listeners.forEach(listener => listener());
    },
};

function normalizeDanmakuFrameRateLimit(value: unknown): WatchDanmakuFrameRateLimit {
    return value === '60' || value === '72' || value === '120' || value === '144' ? value : 'auto';
}

export function useSettings(): AppSettings {
    return useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
}

function normalizeSubtitlePreferredKeywords(value: unknown, ...legacyValues: unknown[]): string[] {
    const values = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : legacyValues.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    const uniqueValues = values.filter((item, index) => item.trim().length === 0 || values.indexOf(item) === index);
    return [...uniqueValues, ...Array.from({ length: Math.max(0, 3 - uniqueValues.length) }, () => '')];
}

function normalizeChannelIds(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0)));
}

function normalizePercent(value: unknown, minimum: number, maximum: number, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? Math.round(parsed) : fallback;
}

function normalizeListLength(value: unknown, fallback: number, maximum: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : fallback;
}
