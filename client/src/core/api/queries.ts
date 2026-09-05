import type {
    AnnictStatus,
    AnnictEpisodeWatchOption,
    AnnictRecordedEpisodeInfo,
    AnnictViewerStatusKind,
    AnnictViewerStatuses,
    AnnictWorkDetail,
    AnnictWorkList,
    BlueskyStatus,
    BulkRecordedOperationResult,
    BulkUpdateRecordedUserOption,
    ChannelItem,
    ChannelScheduleOption,
    ChannelJikkyoStatus,
    AddManualEncodeProgramOption,
    AddRuleOption,
    Config,
    CreateNewRecordedOption,
    DiscordNotificationSettings,
    EncodeId,
    EncodeInfo,
    EditManualReserveOption,
    GetRecordedOption,
    GetReserveListsOption,
    GetReserveOption,
    ManualReserveOption,
    MisskeyStatus,
    MisskeyAuthorizationCheck,
    MisskeyAuthorizationStart,
    MisskeyVisibility,
    MoveRecordedSubDirectoryOption,
    NiconicoLoginResult,
    NiconicoStatus,
    Records,
    RecordedId,
    RecordedItem,
    RecordedPlayback,
    RecordedPlaybackHistory,
    RecordedPlaybackHistorySettings,
    RecordedListPosition,
    RecordedSearchOptions,
    RecordedSubDirectories,
    ProgramId,
    RecordedCleanupExecuteResult,
    RecordedCleanupPlanResult,
    Rule,
    RuleId,
    Rules,
    GetRuleOption,
    ReserveCnts,
    ReserveId,
    ReserveItem,
    ReserveLists,
    Reserves,
    ScheduleProgramItem,
    Schedule,
    BroadcastingScheduleOption,
    ScheduleOption,
    ScheduleSearchOption,
    SystemGpuList,
    SystemLogCategory,
    SystemLogInfo,
    SystemLogLevel,
    SystemLogLevelSetting,
    SystemLogSource,
    SystemMirakurunInfo,
    SystemResourceInfo,
    SystemStorageVolumeList,
    SystemUpdateInfo,
    SystemUpdateJob,
    StartSystemUpdateOption,
    StorageInfo,
    TwitterStatus,
    TwitterTimeline,
    UploadVideoFileOption,
    UpdateRecordedPlaybackOption,
    UpdateDiscordNotificationSettings,
    Users,
    ViewerProfiles,
    ViewerProfileRecoveryCode,
    ViewerProfileSession,
    VideoFileId,
    VideoPreparedSubtitle,
    SubtitleTransferOption,
    SubtitleTransferTask,
    SubtitleRenameOption,
    SubtitleReorderOption,
    VideoSubtitles,
    VideoSubtitleText,
    VersionInfo,
} from '../../../../api';
import { apiClient } from './client';

export interface VideoAnalysisStream {
    index: number;
    type: string;
    codec?: string;
    profile?: string;
    language?: string;
    title?: string;
    channels?: number;
    sampleRate?: number;
    width?: number;
    height?: number;
    frameRate?: number;
    pixelFormat?: string;
    bitDepth?: number;
    hdr?: string;
    isDefault: boolean;
    isForced: boolean;
}
export interface VideoAnalysisInfo {
    videoFileId: number;
    fileName: string;
    formatName: string | null;
    size: number;
    duration: number | null;
    startTime: number | null;
    bitRate: number | null;
    videoCodec: string | null;
    videoProfile: string | null;
    width: number | null;
    height: number | null;
    frameRate: number | null;
    pixelFormat: string | null;
    bitDepth: number | null;
    hdr: string | null;
    streams: VideoAnalysisStream[];
    analyzedAt: number | null;
    analysisError: string | null;
    ts: Record<string, unknown> | null;
}

function playbackUserHeader(userId: number): Record<string, string> {
    return {
        'X-EPGStation-User-Id': String(userId),
    };
}

export const api = {
    async getViewerProfiles(): Promise<ViewerProfiles> {
        return (await apiClient.get<ViewerProfiles>('/viewer-profiles')).data;
    },
    async addViewerProfile(tvUserId: number, password?: string): Promise<number> {
        return (await apiClient.post<{ profileId: number }>('/viewer-profiles', { tvUserId, ...(password === undefined ? {} : { password }) })).data.profileId;
    },
    async unlockViewerProfile(profileId: number, password: string): Promise<ViewerProfileSession> {
        return (await apiClient.post<ViewerProfileSession>(`/viewer-profiles/${profileId}/unlock`, { password })).data;
    },
    async validateViewerProfileSession(profileId: number): Promise<boolean> {
        return (await apiClient.get<{ valid: boolean }>(`/viewer-profiles/${profileId}/session`)).data.valid;
    },
    async updateViewerProfileLock(profileId: number, password?: string): Promise<ViewerProfileSession> {
        return (await apiClient.put<ViewerProfileSession>(`/viewer-profiles/${profileId}/lock`, { password })).data;
    },
    async rotateViewerProfileRecoveryCode(profileId: number): Promise<ViewerProfileRecoveryCode> {
        return (await apiClient.post<ViewerProfileRecoveryCode>(`/viewer-profiles/${profileId}/recovery-code`)).data;
    },
    async getTwitterStatus(): Promise<TwitterStatus> {
        return (await apiClient.get<TwitterStatus>('/twitter/status')).data;
    },
    async connectTwitter(cookiesText: string, userAgent?: string): Promise<TwitterStatus> {
        return (await apiClient.put<TwitterStatus>('/twitter/auth', { cookiesText, userAgent })).data;
    },
    async disconnectTwitter(): Promise<void> {
        await apiClient.delete('/twitter/auth');
    },
    async getTwitterTimeline(): Promise<TwitterTimeline> {
        return (await apiClient.get<TwitterTimeline>('/twitter/timeline', { timeout: 45_000 })).data;
    },
    async searchTwitter(query: string): Promise<TwitterTimeline> {
        return (await apiClient.get<TwitterTimeline>('/twitter/search', { params: { query }, timeout: 45_000 })).data;
    },
    async postTweet(text: string): Promise<void> {
        await apiClient.post('/twitter/tweet', { text }, { timeout: 45_000 });
    },
    async getBlueskyStatus(): Promise<BlueskyStatus> {
        return (await apiClient.get<BlueskyStatus>('/bluesky/status')).data;
    },
    async connectBluesky(handle: string, appPassword: string): Promise<BlueskyStatus> {
        return (await apiClient.put<BlueskyStatus>('/bluesky/auth', { handle, appPassword })).data;
    },
    async disconnectBluesky(): Promise<void> {
        await apiClient.delete('/bluesky/auth');
    },
    async getBlueskyTimeline(): Promise<TwitterTimeline> {
        return (await apiClient.get<TwitterTimeline>('/bluesky/timeline', { timeout: 30_000 })).data;
    },
    async searchBluesky(query: string): Promise<TwitterTimeline> {
        return (await apiClient.get<TwitterTimeline>('/bluesky/search', { params: { query }, timeout: 30_000 })).data;
    },
    async postBluesky(text: string): Promise<void> {
        await apiClient.post('/bluesky/post', { text }, { timeout: 30_000 });
    },
    async getMisskeyStatus(): Promise<MisskeyStatus> {
        return (await apiClient.get<MisskeyStatus>('/misskey/status')).data;
    },
    async startMisskeyAuthorization(visibility: MisskeyVisibility): Promise<MisskeyAuthorizationStart> {
        return (await apiClient.post<MisskeyAuthorizationStart>('/misskey/auth', { visibility })).data;
    },
    async checkMisskeyAuthorization(sessionId: string): Promise<MisskeyAuthorizationCheck> {
        return (await apiClient.patch<MisskeyAuthorizationCheck>('/misskey/auth', { sessionId })).data;
    },
    async disconnectMisskey(): Promise<void> {
        await apiClient.delete('/misskey/auth');
    },
    async getMisskeyTimeline(): Promise<TwitterTimeline> {
        return (await apiClient.get<TwitterTimeline>('/misskey/timeline', { timeout: 30_000 })).data;
    },
    async searchMisskey(query: string): Promise<TwitterTimeline> {
        return (
            await apiClient.get<TwitterTimeline>('/misskey/search', {
                params: { query },
                timeout: 30_000,
            })
        ).data;
    },
    async postMisskey(text: string): Promise<void> {
        await apiClient.post('/misskey/post', { text }, { timeout: 30_000 });
    },
    async getNiconicoStatus(): Promise<NiconicoStatus> {
        return (await apiClient.get<NiconicoStatus>('/niconico/status')).data;
    },
    async loginNiconico(cookiesText: string): Promise<NiconicoLoginResult> {
        return (await apiClient.post<NiconicoLoginResult>('/niconico/auth', { cookiesText }, { timeout: 30_000 })).data;
    },
    async disconnectNiconico(): Promise<void> {
        await apiClient.delete('/niconico/auth');
    },
    async getAnnictStatus(): Promise<AnnictStatus> {
        return (await apiClient.get<AnnictStatus>('/annict/status')).data;
    },
    async setAnnictToken(accessToken: string): Promise<void> {
        await apiClient.put('/annict/token', { accessToken });
    },
    async deleteAnnictToken(): Promise<void> {
        await apiClient.delete('/annict/token');
    },
    async setAnnictWriteToken(accessToken: string): Promise<void> {
        await apiClient.put('/annict/write-token', { accessToken });
    },
    async deleteAnnictWriteToken(): Promise<void> {
        await apiClient.delete('/annict/write-token');
    },
    async getAnnictViewerStatuses(annictIds: number[]): Promise<AnnictViewerStatuses> {
        return (await apiClient.post<AnnictViewerStatuses>('/annict/viewer-statuses', { annictIds })).data;
    },
    async setAnnictViewerStatuses(annictIds: number[], kind: AnnictViewerStatusKind): Promise<void> {
        await apiClient.put('/annict/viewer-statuses', { annictIds, kind });
    },
    async linkAnnictRule(ruleId: RuleId, annictId: number): Promise<void> {
        await apiClient.put(`/annict/rules/${ruleId}`, { annictId });
    },
    async getRecordedAnnictEpisode(recordedId: RecordedId): Promise<AnnictRecordedEpisodeInfo> {
        return (await apiClient.get<AnnictRecordedEpisodeInfo>(`/recorded/${recordedId}/annictEpisode`)).data;
    },
    async retryRecordedAnnictEpisode(recordedId: RecordedId): Promise<AnnictRecordedEpisodeInfo> {
        return (await apiClient.post<AnnictRecordedEpisodeInfo>(`/recorded/${recordedId}/annictEpisode`)).data;
    },
    async markRecordedAnnictEpisodeWatched(recordedId: RecordedId, option: AnnictEpisodeWatchOption): Promise<AnnictRecordedEpisodeInfo> {
        return (await apiClient.put<AnnictRecordedEpisodeInfo>(`/recorded/${recordedId}/annictEpisode`, option)).data;
    },
    async unmarkRecordedAnnictEpisodeWatched(recordedId: RecordedId): Promise<AnnictRecordedEpisodeInfo> {
        return (await apiClient.delete<AnnictRecordedEpisodeInfo>(`/recorded/${recordedId}/annictEpisode`)).data;
    },
    async getRecordedPlayback(recordedId: RecordedId, userId: number): Promise<RecordedPlayback> {
        return (
            await apiClient.get<RecordedPlayback>(`/recorded/${recordedId}/playback`, {
                headers: playbackUserHeader(userId),
                timeout: 3_000,
            })
        ).data;
    },
    async updateRecordedPlayback(recordedId: RecordedId, option: UpdateRecordedPlaybackOption, userId: number): Promise<RecordedPlayback> {
        return (
            await apiClient.put<RecordedPlayback>(`/recorded/${recordedId}/playback`, option, {
                headers: playbackUserHeader(userId),
            })
        ).data;
    },
    async getRecordedPlaybackHistory(userId: number, isHalfWidth: boolean, limit: number): Promise<RecordedPlaybackHistory> {
        return (
            await apiClient.get<RecordedPlaybackHistory>('/recorded/playbackHistory', {
                params: { isHalfWidth, limit },
                headers: playbackUserHeader(userId),
                timeout: 10_000,
            })
        ).data;
    },
    async getRecordedPlaybackHistorySettings(userId: number): Promise<RecordedPlaybackHistorySettings> {
        return (
            await apiClient.get<RecordedPlaybackHistorySettings>('/recorded/playbackHistory/settings', {
                headers: playbackUserHeader(userId),
            })
        ).data;
    },
    async updateRecordedPlaybackHistorySettings(userId: number, enabled: boolean): Promise<RecordedPlaybackHistorySettings> {
        return (await apiClient.put<RecordedPlaybackHistorySettings>('/recorded/playbackHistory/settings', { enabled }, { headers: playbackUserHeader(userId) })).data;
    },
    async removeRecordedPlaybackHistory(recordedId: RecordedId, userId: number): Promise<void> {
        await apiClient.delete(`/recorded/${recordedId}/playback`, { headers: playbackUserHeader(userId) });
    },
    async getAnnictWorks(season: string, refresh = false, rerun = false): Promise<AnnictWorkList> {
        return (await apiClient.get<AnnictWorkList>('/annict/works', { params: { season, refresh, rerun } })).data;
    },
    async getAnnictWork(annictId: number, refresh = false): Promise<AnnictWorkDetail> {
        return (await apiClient.get<AnnictWorkDetail>(`/annict/works/${annictId}`, { params: { refresh } })).data;
    },
    async getConfig(): Promise<Config> {
        const config = (await apiClient.get<Config>('/config')).data;
        const encode = Array.isArray(config.encode) ? config.encode.filter((mode): mode is string => typeof mode === 'string' && mode.trim().length > 0) : [];
        return { ...config, encode };
    },
    async getDiscordNotificationSettings(): Promise<DiscordNotificationSettings> {
        return (await apiClient.get<DiscordNotificationSettings>('/discord/settings')).data;
    },
    async updateDiscordNotificationSettings(settings: UpdateDiscordNotificationSettings): Promise<DiscordNotificationSettings> {
        return (await apiClient.put<DiscordNotificationSettings>('/discord/settings', settings)).data;
    },
    async testDiscordNotification(destinationId: string): Promise<void> {
        await apiClient.post('/discord/test', { destinationId });
    },
    async getVersion(): Promise<VersionInfo> {
        return (await apiClient.get<VersionInfo>('/version')).data;
    },
    async getSystemUpdateInfo(refresh = false): Promise<SystemUpdateInfo> {
        return (await apiClient.get<SystemUpdateInfo>('/system/update', { params: { refresh }, timeout: 45_000 })).data;
    },
    async startSystemUpdate(option: StartSystemUpdateOption): Promise<SystemUpdateJob> {
        return (await apiClient.post<SystemUpdateJob>('/system/update', option)).data;
    },
    async restartAfterSystemUpdate(): Promise<void> {
        await apiClient.post('/system/update/restart');
    },
    async getUsers(): Promise<Users> {
        return (await apiClient.get<Users>('/users')).data;
    },
    async getChannels(): Promise<ChannelItem[]> {
        return (await apiClient.get<ChannelItem[]>('/channels')).data;
    },
    async getChannelJikkyoStatuses(): Promise<ChannelJikkyoStatus[]> {
        return (await apiClient.get<ChannelJikkyoStatus[]>('/channels/jikkyo')).data;
    },
    async addUser(name: string): Promise<number> {
        return (await apiClient.post<{ userId: number }>('/users', { name })).data.userId;
    },
    async updateUser(userId: number, name: string): Promise<void> {
        await apiClient.put(`/users/${userId}`, { name });
    },
    async deleteUser(userId: number): Promise<void> {
        await apiClient.delete(`/users/${userId}`);
    },
    async getRecording(option: GetRecordedOption): Promise<Records> {
        return (await apiClient.get<Records>('/recording', { params: option })).data;
    },
    async getRecorded(option: GetRecordedOption): Promise<Records> {
        return (await apiClient.get<Records>('/recorded', { params: option })).data;
    },
    async getRecordedItem(recordedId: RecordedId, isHalfWidth: boolean): Promise<RecordedItem> {
        return (await apiClient.get<RecordedItem>(`/recorded/${recordedId}`, { params: { isHalfWidth } })).data;
    },
    async getRecordedListPosition(recordedId: RecordedId, limit: number): Promise<RecordedListPosition> {
        return (await apiClient.get<RecordedListPosition>(`/recorded/${recordedId}/listPosition`, { params: { limit } })).data;
    },
    async createRecorded(option: CreateNewRecordedOption): Promise<RecordedId> {
        return (await apiClient.post<{ recordedId: RecordedId }>('/recorded', option)).data.recordedId;
    },
    async deleteRecorded(recordedId: RecordedId): Promise<void> {
        await apiClient.delete(`/recorded/${recordedId}`);
    },
    async protectRecorded(recordedId: RecordedId): Promise<void> {
        await apiClient.put(`/recorded/${recordedId}/protect`);
    },
    async unprotectRecorded(recordedId: RecordedId): Promise<void> {
        await apiClient.put(`/recorded/${recordedId}/unprotect`);
    },
    async updateRecordedUser(recordedId: RecordedId, userId: number): Promise<void> {
        await apiClient.put(`/recorded/${recordedId}/user`, { userId });
    },
    async bulkUpdateRecordedUser(option: BulkUpdateRecordedUserOption): Promise<BulkRecordedOperationResult> {
        return (await apiClient.put<BulkRecordedOperationResult>('/recorded/bulk/user', option)).data;
    },
    async getRecordedSubDirectories(): Promise<RecordedSubDirectories> {
        return (await apiClient.get<RecordedSubDirectories>('/recorded/directories')).data;
    },
    async moveRecordedToSubDirectory(option: MoveRecordedSubDirectoryOption): Promise<BulkRecordedOperationResult> {
        return (await apiClient.put<BulkRecordedOperationResult>('/recorded/bulk/subDirectory', option)).data;
    },
    async getDropLog(dropLogFileId: number, maxsize = 512): Promise<string> {
        return (await apiClient.get<string>(`/dropLogs/${dropLogFileId}`, { params: { maxsize }, responseType: 'text' })).data;
    },
    async getRecordedSearchOptions(): Promise<RecordedSearchOptions> {
        return (await apiClient.get<RecordedSearchOptions>('/recorded/options')).data;
    },
    async getLatestRecordedCleanupPlan(): Promise<RecordedCleanupPlanResult | null> {
        const response = await apiClient.get<RecordedCleanupPlanResult>('/recorded/cleanupPlan');
        return response.status === 204 ? null : response.data;
    },
    async createRecordedCleanupPlan(): Promise<RecordedCleanupPlanResult> {
        return (await apiClient.post<RecordedCleanupPlanResult>('/recorded/cleanupPlan', undefined, { timeout: 0 })).data;
    },
    async executeRecordedCleanupPlan(planPath: string): Promise<RecordedCleanupExecuteResult> {
        return (await apiClient.post<RecordedCleanupExecuteResult>('/recorded/cleanupExecute', { planPath }, { timeout: 0 })).data;
    },
    async uploadVideo(option: UploadVideoFileOption): Promise<RecordedId> {
        const form = new FormData();
        if (option.recordedId !== undefined) form.append('recordedId', String(option.recordedId));
        if (option.userId !== undefined) form.append('userId', String(option.userId));
        if (option.channelId !== undefined) form.append('channelId', String(option.channelId));
        if (option.startAt !== undefined) form.append('startAt', String(option.startAt));
        if (option.duration !== undefined) form.append('duration', String(option.duration));
        if (option.name !== undefined) form.append('name', option.name);
        if (option.description !== undefined) form.append('description', option.description);
        if (option.extended !== undefined) form.append('extended', option.extended);
        form.append('parentDirectoryName', option.parentDirectoryName);
        form.append('viewName', option.viewName);
        form.append('fileType', option.fileType);
        form.append('file', option.file);
        if (option.subDirectory !== undefined) {
            form.append('subDirectory', option.subDirectory);
        }
        return (await apiClient.post<{ recordedId: RecordedId }>('/videos/upload', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 0 })).data.recordedId;
    },
    async deleteVideo(videoFileId: VideoFileId): Promise<void> {
        await apiClient.delete(`/videos/${videoFileId}`);
    },
    async getVideoDuration(videoFileId: VideoFileId): Promise<number> {
        return (await apiClient.get<{ duration: number }>(`/videos/${videoFileId}/duration`)).data.duration;
    },
    async getVideoInfo(videoFileId: VideoFileId, force = false): Promise<VideoAnalysisInfo> {
        return (await apiClient.request<VideoAnalysisInfo>({ method: force ? 'POST' : 'GET', url: `/videos/${videoFileId}/info` })).data;
    },
    async getVideoSubtitles(videoFileId: VideoFileId): Promise<VideoSubtitles> {
        return (await apiClient.get<VideoSubtitles>(`/videos/${videoFileId}/subtitles`)).data;
    },
    async getVideoSubtitleText(videoFileId: VideoFileId, subtitleIndex: number, range?: { startAt: number; duration: number }): Promise<VideoSubtitleText> {
        return (
            await apiClient.get<VideoSubtitleText>(`/videos/${videoFileId}/subtitles/${subtitleIndex}/text`, {
                params: range,
            })
        ).data;
    },
    async prepareVideoSubtitle(videoFileId: VideoFileId, subtitleIndex: number): Promise<VideoPreparedSubtitle> {
        return (await apiClient.post<VideoPreparedSubtitle>(`/videos/${videoFileId}/subtitles/${subtitleIndex}/prepare`, {})).data;
    },
    async startSubtitleTransfer(targetVideoFileId: VideoFileId, option: SubtitleTransferOption): Promise<SubtitleTransferTask> {
        return (await apiClient.post<SubtitleTransferTask>(`/videos/${targetVideoFileId}/subtitles/transfer`, option)).data;
    },
    async startSubtitleRename(videoFileId: VideoFileId, subtitleIndex: number, option: SubtitleRenameOption): Promise<SubtitleTransferTask> {
        return (await apiClient.post<SubtitleTransferTask>(`/videos/${videoFileId}/subtitles/${subtitleIndex}/rename`, option)).data;
    },
    async startSubtitleReorder(videoFileId: VideoFileId, option: SubtitleReorderOption): Promise<SubtitleTransferTask> {
        return (await apiClient.post<SubtitleTransferTask>(`/videos/${videoFileId}/subtitles/reorder`, option)).data;
    },
    async getSubtitleTransferTask(targetVideoFileId: VideoFileId, taskId: string): Promise<SubtitleTransferTask> {
        return (await apiClient.get<SubtitleTransferTask>(`/videos/${targetVideoFileId}/subtitles/transfer/${encodeURIComponent(taskId)}`)).data;
    },
    async stopRecording(recordedId: RecordedId): Promise<void> {
        await apiClient.post(`/recording/${recordedId}/stop`);
    },
    async sendVideoToKodi(videoFileId: VideoFileId, kodiName: string): Promise<void> {
        await apiClient.post(`/videos/${videoFileId}/kodi`, { kodiName });
    },
    async getEncodes(isHalfWidth: boolean): Promise<EncodeInfo> {
        return (await apiClient.get<EncodeInfo>('/encode', { params: { isHalfWidth } })).data;
    },
    async cancelEncode(encodeId: EncodeId): Promise<void> {
        await apiClient.delete(`/encode/${encodeId}`);
    },
    async reorderEncodes(encodeIds: EncodeId[], expectedEncodeIds: EncodeId[]): Promise<void> {
        await apiClient.put('/encode/order', { encodeIds, expectedEncodeIds });
    },
    async addManualEncode(option: AddManualEncodeProgramOption): Promise<EncodeId> {
        return (await apiClient.post<{ encodeId: EncodeId }>('/encode', option)).data.encodeId;
    },
    async stopRecordedEncode(recordedId: RecordedId): Promise<void> {
        await apiClient.delete(`/recorded/${recordedId}/encode`);
    },
    async replaceThumbnail(videoFileId: VideoFileId): Promise<void> {
        await apiClient.post(`/thumbnails/videos/${videoFileId}/replace`);
    },
    async getStorages(): Promise<StorageInfo> {
        return (await apiClient.get<StorageInfo>('/storages')).data;
    },
    async getSystemLog(source: SystemLogSource, category: SystemLogCategory, lines: number = 500): Promise<SystemLogInfo> {
        return (await apiClient.get<SystemLogInfo>('/system/logs', { params: { source, category, lines } })).data;
    },
    async setSystemLogLevel(source: SystemLogSource, category: SystemLogCategory, level: SystemLogLevel): Promise<SystemLogLevelSetting> {
        return (await apiClient.put<SystemLogLevelSetting>('/system/logs', { source, category, level })).data;
    },
    async getSystemGpus(): Promise<SystemGpuList> {
        return (await apiClient.get<SystemGpuList>('/system/gpus')).data;
    },
    async getSystemResources(): Promise<SystemResourceInfo> {
        return (await apiClient.get<SystemResourceInfo>('/system/resources')).data;
    },
    async getSystemVolumes(): Promise<SystemStorageVolumeList> {
        return (await apiClient.get<SystemStorageVolumeList>('/system/volumes')).data;
    },
    async getSystemMirakurun(): Promise<SystemMirakurunInfo> {
        return (await apiClient.get<SystemMirakurunInfo>('/system/mirakurun')).data;
    },
    async getReserves(option: GetReserveOption): Promise<Reserves> {
        return (await apiClient.get<Reserves>('/reserves', { params: option })).data;
    },
    async getReserveCounts(): Promise<ReserveCnts> {
        return (await apiClient.get<ReserveCnts>('/reserves/cnts')).data;
    },
    async getReserveLists(option: GetReserveListsOption): Promise<ReserveLists> {
        return (await apiClient.get<ReserveLists>('/reserves/lists', { params: option })).data;
    },
    async searchPrograms(option: ScheduleSearchOption): Promise<ScheduleProgramItem[]> {
        return (await apiClient.post<ScheduleProgramItem[]>('/schedules/search', option)).data;
    },
    async getSchedules(option: ScheduleOption): Promise<Schedule[]> {
        const params: Record<string, unknown> = { ...option };
        if (option.channelTypes !== undefined) {
            delete params.channelTypes;
            params['channelTypes[]'] = option.channelTypes;
        }
        return (await apiClient.get<Schedule[]>('/schedules', { params })).data;
    },
    async getSchedule(programId: ProgramId, isHalfWidth: boolean): Promise<ScheduleProgramItem> {
        return (await apiClient.get<ScheduleProgramItem>(`/schedules/detail/${programId}`, { params: { isHalfWidth } })).data;
    },
    async getChannelSchedules(option: ChannelScheduleOption): Promise<Schedule[]> {
        const { channelId, ...params } = option;
        return (await apiClient.get<Schedule[]>(`/schedules/${channelId}`, { params })).data;
    },
    async getBroadcastingSchedules(option: BroadcastingScheduleOption): Promise<Schedule[]> {
        return (await apiClient.get<Schedule[]>('/schedules/broadcasting', { params: option })).data;
    },
    async addReserve(option: ManualReserveOption): Promise<ReserveId> {
        return (await apiClient.post<{ reserveId: ReserveId }>('/reserves', option)).data.reserveId;
    },
    async getReserve(reserveId: ReserveId, isHalfWidth: boolean): Promise<ReserveItem> {
        return (await apiClient.get<ReserveItem>(`/reserves/${reserveId}`, { params: { isHalfWidth } })).data;
    },
    async updateReserve(reserveId: ReserveId, option: EditManualReserveOption): Promise<void> {
        await apiClient.put(`/reserves/${reserveId}`, option);
    },
    async cancelReserve(reserveId: ReserveId): Promise<void> {
        await apiClient.delete(`/reserves/${reserveId}`);
    },
    async updateReserves(): Promise<void> {
        await apiClient.post('/reserves/update');
    },
    async removeReserveSkip(reserveId: ReserveId): Promise<void> {
        await apiClient.delete(`/reserves/${reserveId}/skip`);
    },
    async removeReserveOverlap(reserveId: ReserveId): Promise<void> {
        await apiClient.delete(`/reserves/${reserveId}/overlap`);
    },
    async getRules(option: GetRuleOption): Promise<Rules> {
        return (await apiClient.get<Rules>('/rules', { params: option })).data;
    },
    async getRule(ruleId: RuleId): Promise<Rule> {
        return (await apiClient.get<Rule>(`/rules/${ruleId}`)).data;
    },
    async addRule(option: AddRuleOption): Promise<RuleId> {
        return (await apiClient.post<{ ruleId: RuleId }>('/rules', option)).data.ruleId;
    },
    async updateRule(ruleId: RuleId, option: AddRuleOption, syncAnnictStopWatching = true): Promise<void> {
        await apiClient.put(`/rules/${ruleId}`, option, { params: { syncAnnictStopWatching } });
    },
    async deleteRule(ruleId: RuleId): Promise<void> {
        await apiClient.delete(`/rules/${ruleId}`);
    },
    async enableRule(ruleId: RuleId): Promise<void> {
        await apiClient.put(`/rules/${ruleId}/enable`);
    },
    async disableRule(ruleId: RuleId, syncAnnictStopWatching = true): Promise<void> {
        await apiClient.put(`/rules/${ruleId}/disable`, undefined, { params: { syncAnnictStopWatching } });
    },
};
