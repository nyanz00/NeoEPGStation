export const defaultSideNavigationOrder = [
    'dashboard',
    'onair',
    'guide',
    'anime',
    'recording',
    'recorded',
    'encode',
    'reserves',
    'search',
    'rule',
    'history',
    'system',
    'settings',
] as const;

export type SideNavigationItemId = (typeof defaultSideNavigationOrder)[number];

export const sideNavigationLabels: Record<SideNavigationItemId, string> = {
    dashboard: 'ダッシュボード',
    onair: '放映中',
    guide: '番組表',
    anime: 'アニメ',
    recording: '録画中',
    recorded: '録画済み',
    encode: 'エンコード',
    reserves: '予約',
    search: '検索',
    rule: 'ルール',
    history: '視聴履歴',
    system: 'システム',
    settings: '設定',
};

const sideNavigationIds = new Set<string>(defaultSideNavigationOrder);

export function isSideNavigationItemId(value: unknown): value is SideNavigationItemId {
    return typeof value === 'string' && sideNavigationIds.has(value);
}

export function normalizeSideNavigationOrder(value: unknown): SideNavigationItemId[] {
    const normalized = Array.isArray(value) ? value.filter(isSideNavigationItemId).filter((item, index, items) => items.indexOf(item) === index) : [];
    const missing = defaultSideNavigationOrder.filter(item => !normalized.includes(item));
    const settingsIndex = normalized.indexOf('settings');
    if (settingsIndex === -1) return [...normalized, ...missing];
    return [...normalized.slice(0, settingsIndex), ...missing.filter(item => item !== 'settings'), ...normalized.slice(settingsIndex)];
}

export function normalizeHiddenSideNavigationItems(value: unknown): SideNavigationItemId[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(isSideNavigationItemId)
        .filter(item => item !== 'settings')
        .filter((item, index, items) => items.indexOf(item) === index);
}

/**
 * Go back without adding another copy of the destination to browser history.
 * Directly opened pages have no React Router history entry, so replace them
 * with the caller-provided safe destination instead.
 */
export function useAppBack(fallback: To): () => void {
    const navigate = useNavigate();
    const location = useLocation();

    return useCallback(() => {
        const state = window.history.state as { idx?: unknown } | null;
        if (typeof state?.idx === 'number' && state.idx > 0) {
            void navigate(-1);
            return;
        }
        const routeState = location.state;
        const returnTo = typeof routeState === 'object' && routeState !== null && 'appBack' in routeState && typeof routeState.appBack === 'string' ? routeState.appBack : null;
        void navigate(returnTo ?? fallback, { replace: true });
    }, [fallback, location.state, navigate]);
}
import { useCallback } from 'react';
import { type To, useLocation, useNavigate } from 'react-router-dom';
