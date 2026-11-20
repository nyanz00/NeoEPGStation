import type { AnnictWorkList, AnnictWorkSummary } from '../../../api';

export function workStartDateValue(work: AnnictWorkSummary, source?: AnnictWorkList['broadcastDateSource']): number {
    if (source === 'work') {
        const date = work.releasedOn;
        if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.POSITIVE_INFINITY;
        const value = Date.parse(date);
        return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : Number.POSITIVE_INFINITY;
    }
    const value = Date.parse(work.firstReceivableProgramStartedAt ?? '');
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}
