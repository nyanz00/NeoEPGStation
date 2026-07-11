import { useSyncExternalStore } from 'react';

export type ActiveUserId = number | 'master' | null;

function loadActiveUser(): ActiveUserId {
    try {
        const saved = localStorage.getItem('activeUser');
        if (saved === null) {
            return null;
        }
        return (JSON.parse(saved) as { userId?: ActiveUserId }).userId ?? null;
    } catch {
        return null;
    }
}

let snapshot = loadActiveUser();
const listeners = new Set<() => void>();

export const activeUserStore = {
    getSnapshot: (): ActiveUserId => snapshot,
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    save(userId: ActiveUserId): void {
        snapshot = userId;
        localStorage.setItem('activeUser', JSON.stringify({ userId }));
        listeners.forEach(listener => listener());
    },
};

export function useActiveUser(): ActiveUserId {
    return useSyncExternalStore(activeUserStore.subscribe, activeUserStore.getSnapshot);
}
