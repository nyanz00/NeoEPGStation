const PLAYER_VOLUME_STORAGE_KEY = 'epgstation-player-volume';
const PLAYER_MUTED_STORAGE_KEY = 'epgstation-player-muted';
const LEGACY_DPLAYER_VOLUME_STORAGE_KEY = 'dplayer-volume';
const DEFAULT_PLAYER_VOLUME = 1;

function normalizeVolume(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
    if (!Number.isFinite(parsed)) return null;
    return Math.min(1, Math.max(0, parsed));
}

export function getStoredPlayerVolume(): number {
    try {
        const storedVolume = normalizeVolume(window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY));
        if (storedVolume !== null) return storedVolume;

        const legacyVolume = normalizeVolume(window.localStorage.getItem(LEGACY_DPLAYER_VOLUME_STORAGE_KEY));
        if (legacyVolume !== null) {
            window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(legacyVolume));
            return legacyVolume;
        }
    } catch {
        // localStorage can be unavailable in private or restricted browser contexts.
    }
    return DEFAULT_PLAYER_VOLUME;
}

export function setStoredPlayerVolume(volume: number): void {
    const normalizedVolume = normalizeVolume(volume);
    if (normalizedVolume === null) return;
    try {
        window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(normalizedVolume));
    } catch {
        // Playback must remain usable even when persistence is unavailable.
    }
}

export function getStoredPlayerMuted(): boolean {
    try {
        return window.localStorage.getItem(PLAYER_MUTED_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setStoredPlayerMuted(muted: boolean): void {
    try {
        window.localStorage.setItem(PLAYER_MUTED_STORAGE_KEY, String(muted));
    } catch {
        // Playback must remain usable even when persistence is unavailable.
    }
}
