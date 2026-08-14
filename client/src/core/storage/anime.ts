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
}

export function loadAnimeSortOrder(): AnimeSortOrder {
    try {
        const value = localStorage.getItem(storageKey);
        return value === 'release-date' ? value : 'popularity';
    } catch (_error) {
        return 'popularity';
    }
}

export function saveAnimeSortOrder(value: AnimeSortOrder): void {
    try {
        localStorage.setItem(storageKey, value);
    } catch (_error) {
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
        return { ...(value as Omit<AnimeReturnPosition, 'watchingOnly'>), watchingOnly: value.watchingOnly === true };
    } catch (_error) {
        return null;
    }
}

export function saveAnimeReturnPosition(value: AnimeReturnPosition): void {
    try {
        sessionStorage.setItem(returnPositionStorageKey, JSON.stringify(value));
    } catch (_error) {
        // Session storageが利用できない場合も通常のページ遷移は継続する。
    }
}
