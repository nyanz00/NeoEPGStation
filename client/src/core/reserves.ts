import type { ReserveId, ReserveItem } from '../../../api';
import type { ActiveUserId } from './storage/activeUser';

export type ReserveUserId = Exclude<ActiveUserId, null>;

export interface ResolvedReserveUser {
    userId: ReserveUserId;
    replaceRoute: boolean;
}

export function parseReserveUserFilter(value: string | null): ReserveUserId | undefined {
    if (value === 'master') return 'master';
    const id = Number(value);
    return value !== null && /^[0-9]+$/.test(value) && Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function preferredReserveUser(activeUser: ActiveUserId, availableUserIds: readonly number[] | undefined): ReserveUserId {
    if (activeUser === 'master') return 'master';
    if (typeof activeUser === 'number' && (availableUserIds === undefined || availableUserIds.includes(activeUser))) return activeUser;
    return availableUserIds?.[0] ?? 'master';
}

export function resolveReserveUserFilter(routeValue: string | null, activeUser: ActiveUserId, availableUserIds?: readonly number[]): ResolvedReserveUser {
    const fallback = preferredReserveUser(activeUser, availableUserIds);
    if (routeValue === null) return { userId: fallback, replaceRoute: false };

    const routeUser = parseReserveUserFilter(routeValue);
    if (routeUser === 'master') return { userId: routeUser, replaceRoute: false };
    if (typeof routeUser === 'number' && (availableUserIds === undefined || availableUserIds.includes(routeUser))) {
        return { userId: routeUser, replaceRoute: false };
    }

    return {
        userId: fallback,
        replaceRoute: routeUser === undefined || availableUserIds !== undefined,
    };
}

export function reconcileReserveSelection(selected: ReadonlySet<ReserveId>, visibleIds: readonly ReserveId[]): Set<ReserveId> {
    const visible = new Set(visibleIds);
    const next = new Set([...selected].filter(id => visible.has(id)));
    if (next.size === selected.size && [...next].every(id => selected.has(id))) return selected as Set<ReserveId>;
    return next;
}

export function reserveChangeKind(item: ReserveItem): 'restoreSkip' | 'restoreOverlap' | 'exclude' | 'delete' {
    if (item.isSkip) return 'restoreSkip';
    if (item.isOverlap) return 'restoreOverlap';
    return item.ruleId !== undefined && !item.isEventRelay ? 'exclude' : 'delete';
}

export const reserveChangeCopy = {
    restoreSkip: { title: '除外から予約に戻しますか？', action: '解除', success: '除外から予約に戻しました' },
    restoreOverlap: { title: '重複状態を解除しますか？', action: '解除', success: '重複状態を解除して予約に戻しました' },
    exclude: { title: '番組を除外しますか？', action: '除外', success: '番組を除外しました' },
    delete: { title: '予約を削除しますか？', action: '削除', success: '予約を削除しました' },
};
