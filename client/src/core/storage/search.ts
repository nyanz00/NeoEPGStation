import type { RuleSearchOption } from '../../../../api';
import type { SearchFormState } from '../search/options';

const keyPrefix = 'searchHistory:';
const indexKey = 'searchHistoryKeys';
const maxEntries = 30;

export interface SearchHistorySnapshot {
    routeSearch: string;
    form: SearchFormState;
    submittedOption: RuleSearchOption | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKeywordFields(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.caseSensitive === 'boolean' &&
        typeof value.regexp === 'boolean' &&
        typeof value.name === 'boolean' &&
        typeof value.description === 'boolean' &&
        typeof value.extended === 'boolean'
    );
}

function isSearchHistorySnapshot(value: unknown): value is SearchHistorySnapshot {
    if (!isRecord(value) || !isRecord(value.form)) return false;
    const form = value.form;
    return (
        typeof value.routeSearch === 'string' &&
        typeof form.keyword === 'string' &&
        isKeywordFields(form.keywordFields) &&
        typeof form.ignoreKeyword === 'string' &&
        isKeywordFields(form.ignoreFields) &&
        Array.isArray(form.channelIds) &&
        Array.isArray(form.channelTypes) &&
        Array.isArray(form.genres) &&
        Array.isArray(form.subGenres) &&
        (form.startHour === '' || typeof form.startHour === 'number') &&
        (form.rangeHour === '' || typeof form.rangeHour === 'number') &&
        typeof form.week === 'number' &&
        typeof form.durationMin === 'string' &&
        typeof form.durationMax === 'string' &&
        typeof form.startDate === 'string' &&
        typeof form.startTime === 'string' &&
        typeof form.endDate === 'string' &&
        typeof form.endTime === 'string' &&
        typeof form.isFree === 'boolean' &&
        (value.submittedOption === null || isRecord(value.submittedOption))
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

export function loadSearchHistory(locationKey: string, routeSearch: string): SearchHistorySnapshot | null {
    if (locationKey.length === 0) return null;
    try {
        const value = JSON.parse(sessionStorage.getItem(`${keyPrefix}${locationKey}`) ?? 'null') as unknown;
        return isSearchHistorySnapshot(value) && value.routeSearch === routeSearch ? value : null;
    } catch {
        return null;
    }
}

export function saveSearchHistory(locationKey: string, value: SearchHistorySnapshot): void {
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
        // Search remains usable when session storage is unavailable.
    }
}

export function clearSearchHistory(locationKey: string): void {
    if (locationKey.length === 0) return;
    try {
        sessionStorage.removeItem(`${keyPrefix}${locationKey}`);
        sessionStorage.setItem(indexKey, JSON.stringify(loadIndex().filter(key => key !== locationKey)));
    } catch {
        // Search remains usable when session storage is unavailable.
    }
}
