export type AnimeSortOrder = 'popularity' | 'release-date';

const storageKey = 'animeSortOrder';
const returnPositionStorageKey = 'animeReturnPosition';

export interface AnimeReturnPosition {
    annictId: number;
    year: number;
    seasonName: string;
    showNonTv: boolean;
    watchingOnly: boolean;
    filterKeyword: string;
    /** The display mode of the list that opened the detail page. */
    mode?: 'initial' | 'rerun';
    /** The list scroll position to restore after returning from a work detail. */
    scrollY?: number;
    /** React Router location key of the list entry that opened the detail page. */
    listLocationKey?: string;
}

export function loadAnimeSortOrder(): AnimeSortOrder {
    try {
        const value = localStorage.getItem(storageKey);
        return value === 'release-date' ? value : 'popularity';
    } catch {
        return 'popularity';
    }
}

export function saveAnimeSortOrder(value: AnimeSortOrder): void {
    try {
        localStorage.setItem(storageKey, value);
    } catch {
        // The current selection remains usable when storage is unavailable.
    }
}

export function loadAnimeReturnPosition(): AnimeReturnPosition | null {
    try {
        const value = JSON.parse(sessionStorage.getItem(returnPositionStorageKey) ?? 'null') as Partial<AnimeReturnPosition> | null;
        if (
            value === null ||
            !Number.isInteger(value.annictId) ||
            !Number.isInteger(value.year) ||
            !['winter', 'spring', 'summer', 'autumn'].includes(value.seasonName ?? '') ||
            typeof value.showNonTv !== 'boolean' ||
            typeof value.filterKeyword !== 'string'
        ) {
            return null;
        }
        const annictId = value.annictId as number;
        const year = value.year as number;
        const seasonName = value.seasonName as string;
        const showNonTv = value.showNonTv as boolean;
        const filterKeyword = value.filterKeyword as string;
        const mode = value.mode === 'rerun' || value.mode === 'initial' ? value.mode : undefined;
        const scrollY = typeof value.scrollY === 'number' && Number.isFinite(value.scrollY) && value.scrollY >= 0 ? value.scrollY : undefined;
        const listLocationKey = typeof value.listLocationKey === 'string' && value.listLocationKey.length > 0 ? value.listLocationKey : undefined;
        return {
            annictId,
            year,
            seasonName,
            showNonTv,
            watchingOnly: value.watchingOnly === true,
            filterKeyword,
            ...(mode === undefined ? {} : { mode }),
            ...(scrollY === undefined ? {} : { scrollY }),
            ...(listLocationKey === undefined ? {} : { listLocationKey }),
        };
    } catch {
        return null;
    }
}

export function saveAnimeReturnPosition(value: AnimeReturnPosition): void {
    try {
        sessionStorage.setItem(returnPositionStorageKey, JSON.stringify(value));
    } catch {
        // Session storageが利用できない場合も通常のページ遷移は継続する。
    }
}

export function clearAnimeReturnPosition(): void {
    try {
        sessionStorage.removeItem(returnPositionStorageKey);
    } catch {
        // Session storageが利用できない場合も通常のページ遷移は継続する。
    }
}
