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
    ): Promise<apid.AnnictViewerStatusUpdateResults>;
    linkRule(
        ruleId: apid.RuleId,
        annictId: number,
        viewerProfileId?: apid.ViewerProfileId,
    ): Promise<apid.AnnictRuleLinkResult>;
    syncEnabledRule(ruleId: apid.RuleId): Promise<string | undefined>;
    syncDisabledRule(ruleId: apid.RuleId): Promise<string | undefined>;
    unlinkRule(ruleId: apid.RuleId): Promise<string | undefined>;
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
    getWorks(
        season: string,
        refresh: boolean,
        rerun?: boolean,
        excludePaidChannels?: boolean,
    ): Promise<apid.AnnictWorkList>;
    getWork(annictId: number, refresh: boolean): Promise<apid.AnnictWorkDetail>;
}
