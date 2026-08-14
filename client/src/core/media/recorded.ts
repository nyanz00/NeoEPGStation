import type { Config, RecordedItem, VideoFile } from '../../../../api';
import { withBasePath } from '../path';
import type { AppSettings } from '../storage/settings';

type URLSchemeKind = 'video' | 'download';

function isIPadOS(): boolean {
    return /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;
}

function platformScheme(config: Config, kind: URLSchemeKind): string | undefined {
    const schemes = config.urlscheme[kind];
    if (/iPad|iPhone|iPod/i.test(navigator.userAgent) || isIPadOS()) return schemes.ios;
    if (/Android/i.test(navigator.userAgent)) return schemes.android;
    if (/Macintosh/i.test(navigator.userAgent)) return schemes.mac;
    if (/Windows/i.test(navigator.userAgent)) return schemes.win;
    return undefined;
}

function buildURLScheme(urlScheme: string, address: string, filename: string): string {
    const protocol = window.location.protocol.replace(':', '');
    const targetAddress = /vlc-x-callback/.test(urlScheme) ? encodeURIComponent(address) : address;
    let result = urlScheme;
    if (/Windows/i.test(navigator.userAgent)) {
        result = result.replace(/PROTOCOL:\/\/ADDRESS/g, `${protocol}%3A//${targetAddress}`);
    }
    return result
        .replace(/PROTOCOL/g, protocol)
        .replace(/ADDRESS/g, targetAddress)
        .replace(/FILENAME/g, filename);
}

export function getRecordedVideoRawURL(videoFileId: number): string {
    return withBasePath(`/api/videos/${videoFileId}`);
}

export function getRecordedVideoPlayURL(videoFileId: number): string {
    const userAgent = navigator.userAgent;
    const isAppleMobileWebKit = /AppleWebKit/i.test(userAgent) && (/iPad|iPhone|iPod/i.test(userAgent) || isIPadOS());
    return isAppleMobileWebKit ? withBasePath(`/api/videos/${videoFileId}/web`) : getRecordedVideoRawURL(videoFileId);
}

export function getRecordedVideoPlaylistURL(videoFileId: number): string {
    return `${getRecordedVideoRawURL(videoFileId)}/playlist`;
}

export function getRecordedVideoDownloadRawURL(videoFileId: number): string {
    return `${getRecordedVideoRawURL(videoFileId)}?isDownload=true`;
}

export function getRecordedVideoSchemeURL(video: VideoFile, config: Config, settings: AppSettings, kind: URLSchemeKind): string | null {
    const enabled = kind === 'video' ? settings.shouldUseRecordedViewURLScheme : settings.shouldUseRecordedDownloadURLScheme;
    if (!enabled) return null;
    const custom = kind === 'video' ? settings.recordedViewURLScheme : settings.recordedDownloadURLScheme;
    const scheme = custom !== null && custom.length > 0 ? custom : platformScheme(config, kind);
    if (scheme === undefined || scheme.length === 0) return null;
    const raw = kind === 'video' ? getRecordedVideoRawURL(video.id) : getRecordedVideoDownloadRawURL(video.id);
    return buildURLScheme(scheme, `${window.location.host}${raw}`, video.filename);
}

const kodiHostStorageKey = 'SendVideoFileSelectHostSetting';

export function loadKodiHost(): string | null {
    try {
        const value = JSON.parse(localStorage.getItem(kodiHostStorageKey) ?? 'null') as { hostName?: unknown } | null;
        return typeof value?.hostName === 'string' ? value.hostName : null;
    } catch {
        return null;
    }
}

export function saveKodiHost(hostName: string | null): void {
    try {
        localStorage.setItem(kodiHostStorageKey, JSON.stringify({ hostName }));
    } catch {
        // Keep the current selection usable even when storage is unavailable.
    }
}

export type RecordedStreamType = 'HLS' | 'HLS-TS';

export interface RecordedRelatedSearchOption {
    keyword?: string;
    ruleId?: number;
}

/** Vue 版の録画済みカードにある search と同じ検索条件を生成する。 */
export function createRecordedRelatedSearchOption(item: Pick<RecordedItem, 'name' | 'ruleId'>): RecordedRelatedSearchOption {
    if (item.ruleId !== undefined) return { ruleId: item.ruleId };

    const title = item.name
        .replace(/\[.+?\]/g, ' ')
        .replace(/\【.+?\】/g, ' ')
        .replace(/\(.\)/g, ' ')
        .replace(/ +/g, ' ')
        .trim();
    const delimiter = title.includes(' #') ? ' #' : title.includes('「') ? '「' : '';
    const keyword = delimiter.length > 0 ? title.split(delimiter)[0] : title;
    return { keyword: keyword.length > 0 ? keyword : title };
}

export interface RecordedStreamOption {
    type: RecordedStreamType;
    qualities: string[];
}

export interface RecordedSelectStreamSettings {
    type: RecordedStreamType;
    mode: number;
    subtitleIndex: number | null;
}

const recordedStreamStorageKey = 'RecordedSelectStreamSetting';

export function loadRecordedSelectStreamSettings(): RecordedSelectStreamSettings {
    try {
        const parsed = JSON.parse(localStorage.getItem(recordedStreamStorageKey) ?? 'null') as Partial<RecordedSelectStreamSettings> | null;
        const type: RecordedStreamType = parsed?.type === 'HLS-TS' ? parsed.type : 'HLS';
        return {
            type,
            mode: Number.isSafeInteger(parsed?.mode) && Number(parsed?.mode) >= 0 ? Number(parsed?.mode) : 0,
            subtitleIndex: Number.isSafeInteger(parsed?.subtitleIndex) ? Number(parsed?.subtitleIndex) : null,
        };
    } catch {
        return { type: 'HLS', mode: 0, subtitleIndex: null };
    }
}

export function saveRecordedSelectStreamSettings(value: RecordedSelectStreamSettings): void {
    try {
        localStorage.setItem(recordedStreamStorageKey, JSON.stringify(value));
    } catch {
        // Keep the current selection usable when storage is unavailable.
    }
}

export function getRecordedStreamOptions(video: VideoFile | null, config: Config | undefined): RecordedStreamOption[] {
    if (video === null || config === undefined) return [];
    const options: RecordedStreamOption[] = [];
    const add = (type: RecordedStreamType, values: string[] | undefined): void => {
        const qualities = (values ?? []).filter(value => value.trim().length > 0);
        if (qualities.length > 0) options.push({ type, qualities });
    };
    if (video.type === 'ts') {
        const streamConfig = config.streamConfig?.recorded?.ts;
        if (streamConfig === undefined) return [];
        add('HLS-TS', streamConfig.hls);
    } else {
        const streamConfig = config.streamConfig?.recorded?.encoded;
        if (streamConfig === undefined) return [];
        add('HLS', streamConfig.hls);
    }
    return options;
}

function recordedStreamParams(mode: number, quality: string, settings: AppSettings, subtitleIndex?: number | null, startPosition = 0, vodSessionId?: string): URLSearchParams {
    const params = new URLSearchParams({ mode: String(mode), quality, ss: Math.max(0, startPosition).toFixed(3) });
    if (settings.watchStreamEncoder !== 'Config') params.set('encoder', settings.watchStreamEncoder);
    if (settings.watchUseHevc) params.set('hevc', 'true');
    if (settings.watchStreamingBufferedStart) params.set('startupBufferSegments', '3');
    params.set('subtitleSize', String(settings.watchStreamingSubtitleSizePercent));
    params.set('subtitleOpacity', String(settings.watchStreamingSubtitleOpacityPercent));
    params.set('subtitleOutlineSize', String(settings.watchStreamingSubtitleOutlineSizePercent));
    params.set('subtitleOutlineOpacity', String(settings.watchStreamingSubtitleOutlineOpacityPercent));
    if (subtitleIndex !== undefined) params.set('subtitleIndex', subtitleIndex === null ? '-1' : String(subtitleIndex));
    if (vodSessionId !== undefined) params.set('vodSessionId', vodSessionId);
    return params;
}

export function getRecordedStreamWatchPath(
    recordedId: number,
    videoFileId: number,
    type: RecordedStreamType,
    mode: number,
    quality: string,
    settings: AppSettings,
    subtitleIndex: number | null,
    subtitleFileKey?: string,
): string {
    const params = recordedStreamParams(mode, quality, settings, subtitleIndex);
    if (subtitleFileKey !== undefined) params.set('subtitleFileKey', subtitleFileKey);
    params.set('recordedId', String(recordedId));
    params.set('videoId', String(videoFileId));
    params.set('type', type.toLowerCase());
    return `/recorded/streaming?${params.toString()}`;
}

export function getRecordedStreamURL(
    videoFileId: number,
    type: RecordedStreamType,
    mode: number,
    quality: string,
    settings: AppSettings,
    subtitleIndex: number | null,
    subtitleFileKey?: string,
    startPosition = 0,
    vodSessionId?: string,
): string {
    const params = recordedStreamParams(mode, quality, settings, subtitleIndex, startPosition, vodSessionId);
    if (subtitleFileKey !== undefined) params.set('subtitleFileKey', subtitleFileKey);
    return `${withBasePath(`/api/streams/recorded/${videoFileId}/vodhls/playlist`)}?${params.toString()}`;
}
