import * as apid from '../../../../api';

export default interface IAnnictApiModel {
    getStatus(viewerProfileId?: apid.ViewerProfileId): Promise<apid.AnnictStatus>;
    setToken(accessToken: string): Promise<void>;
    deleteToken(): Promise<void>;
    setWriteToken(accessToken: string, viewerProfileId: apid.ViewerProfileId): Promise<void>;
    deleteWriteToken(viewerProfileId: apid.ViewerProfileId): Promise<void>;
    getViewerStatuses(annictIds: number[], viewerProfileId: apid.ViewerProfileId): Promise<apid.AnnictViewerStatuses>;
    setViewerStatus(
        annictId: number,
        kind: apid.AnnictViewerStatusKind,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<void>;
    setViewerStatuses(
        annictIds: number[],
        kind: apid.AnnictViewerStatusKind,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<void>;
    linkRule(ruleId: apid.RuleId, annictId: number, viewerProfileId?: apid.ViewerProfileId): Promise<void>;
    syncEnabledRule(ruleId: apid.RuleId): Promise<void>;
    syncDisabledRule(ruleId: apid.RuleId): Promise<void>;
    unlinkRule(ruleId: apid.RuleId): Promise<void>;
    getRecordedEpisode(
        recordedId: apid.RecordedId,
        viewerProfileId?: apid.ViewerProfileId,
        force?: boolean,
    ): Promise<apid.AnnictRecordedEpisodeInfo>;
    matchRecordedEpisode(recordedId: apid.RecordedId, force?: boolean): Promise<void>;
    markRecordedEpisodeWatched(
        recordedId: apid.RecordedId,
        viewerProfileId: apid.ViewerProfileId,
        option: apid.AnnictEpisodeWatchOption,
    ): Promise<apid.AnnictRecordedEpisodeInfo>;
    unmarkRecordedEpisodeWatched(
        recordedId: apid.RecordedId,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<apid.AnnictRecordedEpisodeInfo>;
    retryPendingEpisodeSyncs(): Promise<void>;
    getWorks(season: string, refresh: boolean, rerun?: boolean): Promise<apid.AnnictWorkList>;
    getWork(annictId: number, refresh: boolean): Promise<apid.AnnictWorkDetail>;
}
