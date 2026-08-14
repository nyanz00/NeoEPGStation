export interface AddEncodeSettings {
    encodeMode: string | null;
    parentDirectory: string | null;
    isSaveSameDirectory: boolean;
    removeOriginal: boolean;
    updateThumbnail: boolean;
}

const storageKey = 'AddEncodeSeting';

const defaultSettings: AddEncodeSettings = {
    encodeMode: null,
    parentDirectory: null,
    isSaveSameDirectory: false,
    removeOriginal: false,
    updateThumbnail: true,
};

export function loadAddEncodeSettings(): AddEncodeSettings {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<AddEncodeSettings> | null;
        if (saved === null) return { ...defaultSettings };

        return {
            encodeMode: typeof saved.encodeMode === 'string' ? saved.encodeMode : null,
            parentDirectory: typeof saved.parentDirectory === 'string' ? saved.parentDirectory : null,
            isSaveSameDirectory: saved.isSaveSameDirectory === true,
            removeOriginal: saved.removeOriginal === true,
            updateThumbnail: saved.updateThumbnail !== false,
        };
    } catch {
        return { ...defaultSettings };
    }
}

export function saveAddEncodeSettings(value: AddEncodeSettings): void {
    try {
        localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
        // Keep the current dialog state usable when storage is unavailable.
    }
}
