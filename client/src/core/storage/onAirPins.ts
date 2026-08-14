const storageKey = 'onAirPinnedChannelIds';

export function loadOnAirPinnedChannelIds(): Set<number> {
    try {
        const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown;
        if (!Array.isArray(value)) return new Set();
        return new Set(value.filter((id): id is number => Number.isSafeInteger(id) && id >= 0));
    } catch {
        return new Set();
    }
}

export function saveOnAirPinnedChannelIds(ids: ReadonlySet<number>): void {
    try {
        localStorage.setItem(storageKey, JSON.stringify([...ids].sort((left, right) => left - right)));
    } catch {
        // Keep the in-memory selection usable when storage is unavailable.
    }
}
