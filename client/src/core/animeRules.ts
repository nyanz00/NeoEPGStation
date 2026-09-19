import type { AnnictProgram, AnnictWorkDetail, AnnictWorkSummary, ChannelId, RuleSearchOption } from '../../../api';
import { isAudioVideoChannel, isPaidBroadcastChannel } from './channels';

const openSearchPeriodEndAt = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export function localDateFromIso(value?: string): string | undefined {
    if (value === undefined) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    const year = date.getFullYear().toString(10).padStart(4, '0');
    const month = (date.getMonth() + 1).toString(10).padStart(2, '0');
    const day = date.getDate().toString(10).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function firstBroadcastSearchPeriods(work: Pick<AnnictWorkSummary, 'firstProgramStartedAt'>): RuleSearchOption['searchPeriods'] | undefined {
    const date = localDateFromIso(work.firstProgramStartedAt);
    if (date === undefined) return undefined;
    return [{ startAt: new Date(`${date}T00:00:00`).getTime(), endAt: openSearchPeriodEndAt }];
}

export function animeStationKey(program: AnnictProgram): string {
    return program.channelAnnictId !== undefined ? `annict:${program.channelAnnictId}` : `name:${program.channelName.normalize('NFKC').toUpperCase()}`;
}

/**
 * Build the common search root used by every anime rule/search entry point.
 *
 * Channel and weekday selection differs between the detail and bulk flows,
 * but the title, genre and first-broadcast boundary must never drift apart.
 */
export function buildAnimeSearchOption(work: Pick<AnnictWorkSummary, 'title' | 'firstProgramStartedAt'>, channelIds: ChannelId[] = [], week = 0x7f): RuleSearchOption {
    return {
        keyword: work.title,
        name: true,
        description: false,
        extended: false,
        ...(channelIds.length > 0 ? { channelIds } : {}),
        genres: [{ genre: 7 }],
        times: [{ week: week === 0 ? 0x7f : week }],
        searchPeriods: firstBroadcastSearchPeriods(work),
    };
}

export function buildBulkAnimeSearchOption(
    work: AnnictWorkDetail,
    excludePaidChannels: boolean,
    fallbackChannels: Array<{ id: ChannelId; name: string; type?: number | null }> = [],
    now = Date.now(),
): RuleSearchOption {
    const firstByStation = new Map<string, AnnictProgram>();
    work.programs
        .filter(
            program => program.localChannels.length > 0 && Date.parse(program.startedAt) >= now && (!excludePaidChannels || !isPaidBroadcastChannel({ name: program.channelName })),
        )
        .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
        .forEach(program => {
            const key = animeStationKey(program);
            if (!firstByStation.has(key)) firstByStation.set(key, program);
        });

    const programs = [...firstByStation.values()];
    if (programs.length === 0) {
        const fallbackChannelIds = excludePaidChannels
            ? fallbackChannels.filter(channel => isAudioVideoChannel(channel) && !isPaidBroadcastChannel(channel)).map(channel => channel.id)
            : [];
        return buildAnimeSearchOption(work, fallbackChannelIds);
    }
    const channelIds = Array.from(new Set(programs.flatMap(program => program.localChannels.map(channel => channel.id))));
    const week = programs.reduce((value, program) => value | (1 << new Date(program.startedAt).getDay()), 0);
    return buildAnimeSearchOption(work, channelIds, week);
}
