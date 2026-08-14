import { useSyncExternalStore } from 'react';
import { activeUserStore, useActiveUser, type ActiveUserId } from './activeUser';

interface ViewerProfileSelection {
    profileId: number | null;
    sessionToken?: string;
}

interface LinkedViewerProfile {
    id: number;
    tvUserId?: number;
}

const SESSION_STORAGE_KEY = 'viewerProfileSessions';
const USER_LINK_STORAGE_KEY = 'viewerProfileUserLinks';

function loadRecord(key: string): Record<string, string> {
    try {
        return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string>;
    } catch {
        return {};
    }
}

let userLinks = loadRecord(USER_LINK_STORAGE_KEY);
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
    version += 1;
    listeners.forEach(listener => listener());
}

function selectionForUser(userId: ActiveUserId): ViewerProfileSelection {
    if (typeof userId !== 'number') return { profileId: null };
    const profileId = Number(userLinks[String(userId)]);
    if (!Number.isInteger(profileId) || profileId <= 0) return { profileId: null };
    const sessionToken = loadRecord(SESSION_STORAGE_KEY)[String(profileId)];
    return sessionToken === undefined ? { profileId } : { profileId, sessionToken };
}

export const viewerProfileStore = {
    getSnapshot: (): number => version,
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    syncProfiles(profiles: LinkedViewerProfile[]): void {
        const next: Record<string, string> = {};
        for (const profile of profiles) {
            if (profile.tvUserId !== undefined && next[String(profile.tvUserId)] === undefined) {
                next[String(profile.tvUserId)] = String(profile.id);
            }
        }
        if (JSON.stringify(next) === JSON.stringify(userLinks)) return;
        userLinks = next;
        localStorage.setItem(USER_LINK_STORAGE_KEY, JSON.stringify(next));
        localStorage.removeItem('activeViewerProfile');
        emit();
    },
    linkUser(userId: number, profileId: number): void {
        userLinks = { ...userLinks, [String(userId)]: String(profileId) };
        localStorage.setItem(USER_LINK_STORAGE_KEY, JSON.stringify(userLinks));
        localStorage.removeItem('activeViewerProfile');
        emit();
    },
    unlock(profileId: number, sessionToken: string): void {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ ...loadRecord(SESSION_STORAGE_KEY), [String(profileId)]: sessionToken }));
        emit();
    },
    lock(profileId: number): void {
        const sessions = loadRecord(SESSION_STORAGE_KEY);
        if (sessions[String(profileId)] === undefined) return;
        delete sessions[String(profileId)];
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
        emit();
    },
    forgetUser(userId: number, profileId?: number): void {
        const nextLinks = { ...userLinks };
        delete nextLinks[String(userId)];
        userLinks = nextLinks;
        localStorage.setItem(USER_LINK_STORAGE_KEY, JSON.stringify(nextLinks));
        if (profileId !== undefined) {
            const sessions = loadRecord(SESSION_STORAGE_KEY);
            delete sessions[String(profileId)];
            localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
        }
        emit();
    },
    selectionForUser(userId: ActiveUserId): ViewerProfileSelection {
        return selectionForUser(userId);
    },
    headers(): Record<string, string> {
        const selection = selectionForUser(activeUserStore.getSnapshot());
        if (selection.profileId === null) return {};
        const headers: Record<string, string> = { 'X-Viewer-Profile-Id': String(selection.profileId) };
        if (selection.sessionToken !== undefined) headers['X-Viewer-Session'] = selection.sessionToken;
        return headers;
    },
};

export function useViewerProfile(): ViewerProfileSelection {
    const activeUser = useActiveUser();
    useSyncExternalStore(viewerProfileStore.subscribe, viewerProfileStore.getSnapshot);
    return selectionForUser(activeUser);
}
