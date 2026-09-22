import type { ActiveUserId } from './activeUser';

export interface ManualReserveDraftEncodeSetting {
    mode: string;
    parentDirectoryName: string;
    directory: string;
}

export interface ManualReserveDraftEditorState {
    userId: ActiveUserId;
    allowEndLack: boolean;
    parentDirectoryName: string;
    directory: string;
    recordedFormat: string;
    encodes: [ManualReserveDraftEncodeSetting, ManualReserveDraftEncodeSetting, ManualReserveDraftEncodeSetting];
    deleteOriginal: boolean;
    updateThumbnail: boolean;
}

export interface ManualReserveDraftTimeSpecifiedState {
    enabled: boolean;
    name: string;
    channelId: number | '';
    startAt: string;
    endAt: string;
}

export interface ManualReserveHistorySnapshot {
    routeSearch: string;
    programId: number;
    state: ManualReserveDraftEditorState;
    timeSpecified: ManualReserveDraftTimeSpecifiedState;
}

const keyPrefix = 'manualReserveHistory:';
const indexKey = 'manualReserveHistoryKeys';
const maxEntries = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isActiveUserId(value: unknown): value is ActiveUserId {
    return value === null || value === 'master' || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
}

function isEncodeSetting(value: unknown): value is ManualReserveDraftEncodeSetting {
    return isRecord(value) && typeof value.mode === 'string' && typeof value.parentDirectoryName === 'string' && typeof value.directory === 'string';
}

function isEditorState(value: unknown): value is ManualReserveDraftEditorState {
    return (
        isRecord(value) &&
        isActiveUserId(value.userId) &&
        typeof value.allowEndLack === 'boolean' &&
        typeof value.parentDirectoryName === 'string' &&
        typeof value.directory === 'string' &&
        typeof value.recordedFormat === 'string' &&
        Array.isArray(value.encodes) &&
        value.encodes.length === 3 &&
        value.encodes.every(isEncodeSetting) &&
        typeof value.deleteOriginal === 'boolean' &&
        typeof value.updateThumbnail === 'boolean'
    );
}

function isTimeSpecifiedState(value: unknown): value is ManualReserveDraftTimeSpecifiedState {
    return (
        isRecord(value) &&
        typeof value.enabled === 'boolean' &&
        typeof value.name === 'string' &&
        (value.channelId === '' || (typeof value.channelId === 'number' && Number.isSafeInteger(value.channelId))) &&
        typeof value.startAt === 'string' &&
        typeof value.endAt === 'string'
    );
}

function isHistorySnapshot(value: unknown): value is ManualReserveHistorySnapshot {
    return (
        isRecord(value) &&
        typeof value.routeSearch === 'string' &&
        typeof value.programId === 'number' &&
        Number.isSafeInteger(value.programId) &&
        value.programId >= 0 &&
        isEditorState(value.state) &&
        isTimeSpecifiedState(value.timeSpecified)
    );
}

function loadIndex(): string[] {
    try {
        const value = JSON.parse(sessionStorage.getItem(indexKey) ?? '[]') as unknown;
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

export function loadManualReserveHistory(locationKey: string, routeSearch: string, programId: number): ManualReserveHistorySnapshot | null {
    if (locationKey.length === 0) return null;
    try {
        const value = JSON.parse(sessionStorage.getItem(`${keyPrefix}${locationKey}`) ?? 'null') as unknown;
        return isHistorySnapshot(value) && value.routeSearch === routeSearch && value.programId === programId ? value : null;
    } catch {
        return null;
    }
}

export function saveManualReserveHistory(locationKey: string, value: ManualReserveHistorySnapshot): void {
    if (locationKey.length === 0) return;
    try {
        sessionStorage.setItem(`${keyPrefix}${locationKey}`, JSON.stringify(value));
        const keys = loadIndex().filter(key => key !== locationKey);
        keys.push(locationKey);
        while (keys.length > maxEntries) {
            const expired = keys.shift();
            if (expired !== undefined) sessionStorage.removeItem(`${keyPrefix}${expired}`);
        }
        sessionStorage.setItem(indexKey, JSON.stringify(keys));
    } catch {
        // Manual reservation remains usable when session storage is unavailable.
    }
}

export function clearManualReserveHistory(locationKey: string): void {
    if (locationKey.length === 0) return;
    try {
        sessionStorage.removeItem(`${keyPrefix}${locationKey}`);
        sessionStorage.setItem(indexKey, JSON.stringify(loadIndex().filter(key => key !== locationKey)));
    } catch {
        // Manual reservation remains usable when session storage is unavailable.
    }
}
