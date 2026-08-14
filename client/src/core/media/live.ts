import type { Config } from '../../../../api';
import { withBasePath } from '../path';
import type { AppSettings } from '../storage/settings';

export type LiveStreamType = 'M2TS' | 'M2TS-LL';

export interface OnAirSelectStreamSettings {
    useURLScheme: boolean;
    type: LiveStreamType;
    mode: number;
}

export interface LiveStreamOption {
    type: LiveStreamType;
    qualities: string[];
}

const storageKey = 'OnAirSelectStreamSetting';
const defaultSelection: OnAirSelectStreamSettings = { useURLScheme: false, type: 'M2TS', mode: 0 };

export function loadOnAirSelectStreamSettings(): OnAirSelectStreamSettings {
    try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<OnAirSelectStreamSettings> | null;
        return {
            useURLScheme: parsed?.useURLScheme === true,
            type: parsed?.type === 'M2TS-LL' ? 'M2TS-LL' : 'M2TS',
            mode: Number.isSafeInteger(parsed?.mode) && Number(parsed?.mode) >= 0 ? Number(parsed?.mode) : 0,
        };
    } catch {
        return { ...defaultSelection };
    }
}

export function saveOnAirSelectStreamSettings(value: OnAirSelectStreamSettings): void {
    try {
        localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
        // Keep the current selection usable when storage is unavailable.
    }
}

export function getLiveStreamOptions(config: Config | undefined, settings: AppSettings, useURLScheme: boolean): LiveStreamOption[] {
    const ts = config?.streamConfig?.live?.ts;
    if (ts === undefined) return [];
    const m2ts = (ts.m2ts ?? []).map(item => item.name).filter(name => name.length > 0);
    const m2tsll = (ts.m2tsll ?? []).filter(name => name.length > 0);
    if (useURLScheme) return m2ts.length > 0 ? [{ type: 'M2TS', qualities: m2ts }] : [];
    const options: LiveStreamOption[] = [];
    const push = (type: LiveStreamType, qualities: string[]): void => {
        if (qualities.length > 0) options.push({ type, qualities });
    };
    if (settings.watchLowLatency) {
        push('M2TS-LL', m2tsll);
        push('M2TS', m2ts);
    } else {
        push('M2TS', m2ts);
        push('M2TS-LL', m2tsll);
    }
    return options;
}

function streamParams(mode: number, quality: string, settings: AppSettings): URLSearchParams {
    const params = new URLSearchParams({ mode: String(mode), quality });
    if (settings.watchStreamEncoder !== 'Config') params.set('encoder', settings.watchStreamEncoder);
    if (settings.watchUseHevc) params.set('hevc', 'true');
    return params;
}

export function getLiveWatchPath(channelId: number, type: LiveStreamType, mode: number, quality: string, settings: AppSettings): string {
    const params = streamParams(mode, quality, settings);
    params.set('type', type === 'M2TS-LL' ? 'm2tsll' : 'm2ts');
    params.set('channel', String(channelId));
    return `/onair/watch?${params.toString()}`;
}

export function getLivePlaylistURL(channelId: number, mode: number, quality: string, settings: AppSettings): string {
    return `${withBasePath(`/api/streams/live/${channelId}/m2ts/playlist`)}?${streamParams(mode, quality, settings).toString()}`;
}

export function getLiveStreamURL(channelId: number, type: LiveStreamType, mode: number, quality: string, settings: AppSettings): string {
    const endpoint = type === 'M2TS-LL' ? 'm2tsll' : 'm2ts';
    return `${withBasePath(`/api/streams/live/${channelId}/${endpoint}`)}?${streamParams(mode, quality, settings).toString()}`;
}

function isIPadOS(): boolean {
    return /iPad|Macintosh/i.test(navigator.userAgent) && 'ontouchend' in document;
}

function platformM2TSScheme(config: Config): string | undefined {
    const schemes = config.urlscheme.m2ts;
    if (/iPad|iPhone|iPod/i.test(navigator.userAgent) || isIPadOS()) return schemes.ios;
    if (/Android/i.test(navigator.userAgent)) return schemes.android;
    if (/Macintosh/i.test(navigator.userAgent)) return schemes.mac;
    if (/Windows/i.test(navigator.userAgent)) return schemes.win;
    return undefined;
}

export function getLiveSchemeURL(channelId: number, mode: number, quality: string, config: Config, settings: AppSettings): string | null {
    const scheme = settings.onAirM2TSViewURLScheme || platformM2TSScheme(config);
    if (scheme === undefined || scheme.length === 0) return null;
    const protocol = window.location.protocol.replace(':', '');
    const raw = `${window.location.host}${withBasePath(`/api/streams/live/${channelId}/m2ts`)}?${streamParams(mode, quality, settings).toString()}`;
    const address = /vlc-x-callback/.test(scheme) ? encodeURIComponent(raw) : raw;
    let result = scheme;
    if (/Windows/i.test(navigator.userAgent)) result = result.replace(/PROTOCOL:\/\/ADDRESS/g, `${protocol}%3A//${address}`);
    return result
        .replace(/PROTOCOL/g, protocol)
        .replace(/ADDRESS/g, address)
        .replace(/FILENAME/g, '');
}
