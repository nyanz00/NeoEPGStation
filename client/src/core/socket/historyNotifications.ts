import type { QueryClient } from '@tanstack/react-query';
import type { RecordedPlaybackHistory } from '../../../../api';

function validId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

// General server status/encoding events must not refetch viewing history.
export function invalidatePlaybackHistory(queryClient: QueryClient, update: unknown): void {
    if (update === null || typeof update !== 'object') return;
    const { userId, recordedIds, settings } = update as { userId?: unknown; recordedIds?: unknown; settings?: unknown };
    if (userId !== undefined) {
        if (!validId(userId) || recordedIds !== undefined || (settings !== undefined && typeof settings !== 'boolean')) return;
        void queryClient.invalidateQueries({ queryKey: ['recorded-playback-history', userId] });
        if (settings === true) void queryClient.invalidateQueries({ queryKey: ['recorded-playback-history-settings', userId] });
    } else if (settings === undefined && Array.isArray(recordedIds) && recordedIds.length > 0 && recordedIds.every(validId)) {
        const ids = new Set(recordedIds);
        void queryClient.invalidateQueries({
            predicate: query => {
                if (query.queryKey[0] !== 'recorded-playback-history') return false;
                const history = query.state.data as RecordedPlaybackHistory | undefined;
                return history?.items.some(item => ids.has(item.recorded.id)) === true;
            },
        });
    }
}

export function invalidateAllPlaybackHistory(queryClient: QueryClient): void {
    // A reconnect can follow missed history notifications while offline.
    void queryClient.invalidateQueries({
        predicate: query => query.queryKey[0] === 'recorded-playback-history' || query.queryKey[0] === 'recorded-playback-history-settings',
    });
}
