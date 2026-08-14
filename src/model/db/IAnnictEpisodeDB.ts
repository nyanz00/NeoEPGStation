import AnnictEpisodeWatch from '../../db/entities/AnnictEpisodeWatch';
import AnnictRecordedEpisode from '../../db/entities/AnnictRecordedEpisode';

export interface AnnictEpisodeMatch {
    programAnnictId?: number;
    episodeAnnictId: number;
    episodeNumber?: number;
    episodeNumberText?: string;
    episodeTitle?: string;
}

export default interface IAnnictEpisodeDB {
    findRecorded(recordedId: number): Promise<AnnictRecordedEpisode | null>;
    findRecordedByEpisode(episodeAnnictId: number): Promise<AnnictRecordedEpisode | null>;
    upsertPending(recordedId: number, annictId: number): Promise<AnnictRecordedEpisode>;
    setPending(recordedId: number, reason: string, checkedAt: number): Promise<void>;
    setMatched(recordedId: number, match: AnnictEpisodeMatch, checkedAt: number): Promise<void>;
    findWatch(episodeAnnictId: number, viewerProfileId: number): Promise<AnnictEpisodeWatch | null>;
    findPendingWatches(limit: number, now: number): Promise<AnnictEpisodeWatch[]>;
    beginWatch(episodeAnnictId: number, viewerProfileId: number): Promise<AnnictEpisodeWatch>;
    setWatched(
        episodeAnnictId: number,
        viewerProfileId: number,
        annictRecordId: number | null,
        workAnnictId: number | null,
        statusSyncPending: boolean,
        watchedAt: number,
    ): Promise<void>;
    clearWatchStatusSync(episodeAnnictId: number, viewerProfileId: number): Promise<void>;
    setCompletionPending(
        episodeAnnictId: number,
        viewerProfileId: number,
        workAnnictId: number,
        disableRules: boolean,
        explicitFinalEpisode: boolean,
    ): Promise<void>;
    clearWorkCompletionPending(episodeAnnictId: number, viewerProfileId: number): Promise<void>;
    clearRuleDisablePending(episodeAnnictId: number, viewerProfileId: number): Promise<void>;
    clearCompletionPending(episodeAnnictId: number, viewerProfileId: number): Promise<void>;
    setUnwatched(episodeAnnictId: number, viewerProfileId: number): Promise<void>;
    setWatchFailed(episodeAnnictId: number, viewerProfileId: number, message: string): Promise<void>;
    scheduleWatchRetry(episodeAnnictId: number, viewerProfileId: number, message: string): Promise<void>;
}
