export type UnixtimeMS = number;

export type ChannelId = number;
export type ServiceId = number;
export type NetworkId = number;
export type ProgramId = number;
export type EventId = number;
export type RuleId = number;
export type ReserveId = number;
export type RecordedId = number;
export type RecordedHistoryId = number;
export type VideoFileId = number;
export type VideoFileType = 'ts' | 'encoded';
export type UserId = number;
export type ViewerProfileId = number;
export type ThumbnailId = number;
export type DropLogFileId = number;
export type RecordedTagId = number;
export type EncodeId = number;
export type GRAltChannelType =
    | 'GR-ALT1'
    | 'GR-ALT2'
    | 'GR-ALT3'
    | 'GR-ALT4'
    | 'GR-ALT5'
    | 'GR-ALT6'
    | 'GR-ALT7'
    | 'GR-ALT8'
    | 'GR-ALT9'
    | 'GR-ALT10'
    | 'GR-ALT11'
    | 'GR-ALT12'
    | 'GR-ALT13'
    | 'GR-ALT14'
    | 'GR-ALT15'
    | 'GR-ALT16'
    | 'GR-ALT17'
    | 'GR-ALT18'
    | 'GR-ALT19'
    | 'GR-ALT20';
export type ChannelType = 'GR' | GRAltChannelType | 'BS' | 'CS' | 'SKY';
export type ProgramGenreLv1 = number;
export type ProgramGenreLv2 = number;
export type ProgramVideoType = 'mpeg2' | 'h.264' | 'h.265';
export type ProgramVideoResolution = '240p' | '480i' | '480p' | '720p' | '1080i' | '2160p' | '4320p';
export type ProgramAudioSamplingRate = 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
export type RawExtended = { [description: string]: string };
export type StreamId = number;
export type StreamType = 'LiveStream' | 'LiveHLS' | 'RecordedStream' | 'RecordedHLS';

/**
 * チャンネル情報
 */
export interface ChannelItem {
    id: ChannelId;
    serviceId: ServiceId;
    networkId: NetworkId;
    name: string;
    halfWidthName: string;
    remoteControlKeyId?: number;
    hasLogoData: boolean;
    channelType: ChannelType;
    channel: string;
    type?: number;
}

export interface AnnictStatus {
    configured: boolean;
    writeConfigured: boolean;
    viewerProfileId?: ViewerProfileId;
}

export interface TwitterAccountInfo {
    name: string;
    screenName: string;
    iconUrl?: string;
}

export interface TwitterStatus {
    configured: boolean;
    viewerProfileId?: ViewerProfileId;
    account?: TwitterAccountInfo;
}

export interface TwitterTweet {
    source?: 'twitter' | 'bluesky' | 'misskey';
    id: string;
    url: string;
    text: string;
    authorName: string;
    authorScreenName: string;
    authorIconUrl?: string;
    createdAt?: UnixtimeMS;
    imageUrls: string[];
    replyCount: number;
    retweetCount: number;
    likeCount: number;
    retweeted: boolean;
    liked: boolean;
}

export interface TwitterTimeline {
    tweets: TwitterTweet[];
    refreshedAt: UnixtimeMS;
}

export interface BlueskyAccountInfo {
    name: string;
    handle: string;
    did: string;
    iconUrl?: string;
}

export interface BlueskyStatus {
    configured: boolean;
    viewerProfileId?: ViewerProfileId;
    account?: BlueskyAccountInfo;
}

export type MisskeyVisibility = 'public' | 'home' | 'followers';

export interface MisskeyAccountInfo {
    name: string;
    username: string;
    userId: string;
    instance: string;
    iconUrl?: string;
}

export interface MisskeyStatus {
    configured: boolean;
    viewerProfileId?: ViewerProfileId;
    visibility?: MisskeyVisibility;
    account?: MisskeyAccountInfo;
}

export interface MisskeyAuthorizationStart {
    sessionId: string;
    authorizationUrl: string;
    expiresAt: UnixtimeMS;
}

export interface MisskeyAuthorizationCheck {
    completed: boolean;
    status?: MisskeyStatus;
}

export interface ViewerProfile {
    id: ViewerProfileId;
    name: string;
    tvUserId?: UserId;
    annictConfigured: boolean;
    lockRequired: boolean;
    recoveryCodeConfigured: boolean;
    /** @deprecated lockRequiredを使用してください */
    pinRequired: boolean;
    createdAt: UnixtimeMS;
}

export interface ViewerProfiles {
    profiles: ViewerProfile[];
}

export interface CreateViewerProfileOption {
    password?: string;
    /** @deprecated passwordを使用してください */
    pin?: string;
    tvUserId: UserId;
}

export interface UnlockViewerProfileOption {
    password: string;
    /** @deprecated passwordを使用してください */
    pin?: string;
}

export interface ViewerProfileSession {
    sessionToken: string;
    recoveryCode?: string;
}

export interface ViewerProfileRecoveryCode {
    recoveryCode: string;
}

export type AnnictViewerStatusKind = 'wanna_watch' | 'watching' | 'watched' | 'on_hold' | 'stop_watching' | 'no_select';

export interface AnnictViewerStatus {
    annictId: number;
    kind: AnnictViewerStatusKind;
}

export interface AnnictViewerStatuses {
    statuses: AnnictViewerStatus[];
}

export type AnnictRecordedEpisodeState = 'unlinked' | 'pending' | 'matched';

export type AnnictRecordedEpisodePendingReason =
    'not_checked' | 'program_not_found' | 'program_ambiguous' | 'episode_unavailable' | 'annict_unavailable';

export interface AnnictRecordedEpisodeInfo {
    state: AnnictRecordedEpisodeState;
    annictId?: number;
    programAnnictId?: number;
    episodeAnnictId?: number;
    episodeNumber?: number;
    episodeNumberText?: string;
    episodeTitle?: string;
    pendingReason?: AnnictRecordedEpisodePendingReason;
    lastCheckedAt?: UnixtimeMS;
    viewerProfileId?: ViewerProfileId;
    writeConfigured: boolean;
    watched: boolean;
    canUnwatch: boolean;
}

export interface AnnictEpisodeWatchOption {
    markWorkWatchedOnFinalEpisode: boolean;
    disableRulesOnFinalEpisode: boolean;
}

export interface RecordedPlayback {
    position: number;
    duration: number;
    watchedSeconds: number;
    updatedAt?: UnixtimeMS;
}

export interface UpdateRecordedPlaybackOption {
    position: number;
    duration: number;
    watchedSecondsDelta: number;
    observedAt: UnixtimeMS;
    historyLimit?: number;
}

export interface RecordedPlaybackHistoryItem {
    recorded: RecordedItem;
    playback: RecordedPlayback;
}

export interface RecordedPlaybackHistory {
    items: RecordedPlaybackHistoryItem[];
}

export interface RecordedPlaybackHistorySettings {
    enabled: boolean;
}

export interface RecordedListPosition {
    page: number;
    userId?: UserId;
}

export interface AnnictLocalChannel {
    id: ChannelId;
    name: string;
    channelType: ChannelType;
}

export interface AnnictWorkSummary {
    annictId: number;
    title: string;
    titleKana?: string;
    seasonName?: string;
    seasonYear?: number;
    media?: string;
    imageUrl?: string;
    malAnimeId?: string;
    watchersCount?: number;
    releasedOn?: string;
    releasedOnAbout?: string;
    firstProgramStartedAt?: string;
}

export interface AnnictWorkList {
    season: string;
    works: AnnictWorkSummary[];
    rerun?: boolean;
    cachedAt: number;
    stale: boolean;
}

export interface AnnictProgram {
    annictId: number;
    startedAt: string;
    channelAnnictId?: number;
    channelName: string;
    episodeNumber?: number;
    episodeNumberText?: string;
    episodeTitle?: string;
    episodeNumberEstimated?: boolean;
    firstBroadcast?: boolean;
    rebroadcast: boolean;
    localChannels: AnnictLocalChannel[];
}

export interface AnnictCast {
    annictId: number;
    name: string;
    characterName?: string;
    personName?: string;
}

export interface AnnictStaff {
    annictId: number;
    name: string;
    role?: string;
}

export interface AnnictWorkDetail extends AnnictWorkSummary {
    titleEn?: string;
    synopsis?: string;
    synopsisSource?: string;
    releasedOn?: string;
    releasedOnAbout?: string;
    officialSiteUrl?: string;
    officialSiteUrlEn?: string;
    twitterUsername?: string;
    twitterHashtag?: string;
    wikipediaUrl?: string;
    wikipediaUrlEn?: string;
    syobocalTid?: number;
    casts: AnnictCast[];
    staffs: AnnictStaff[];
    programs: AnnictProgram[];
    programsError?: string;
    cachedAt: number;
    stale: boolean;
}

export interface ChannelJikkyoInfo {
    jikkyoId: string | null;
    watchSessionUrl: string | null;
    commentSessionUrl: string | null;
    nicoliveWatchSessionError?: string | null;
    canPost?: boolean;
    postingTarget?: 'nicolive' | 'nx-jikkyo' | null;
}

export interface ChannelJikkyoStatus {
    channelId: ChannelId;
    jikkyoId: string | null;
    force: number | null;
}

export interface NiconicoAccountInfo {
    userId: string;
    name: string;
    isPremium: boolean;
}

export interface NiconicoStatus {
    configured: boolean;
    viewerProfileId?: ViewerProfileId;
    account?: NiconicoAccountInfo;
}

export interface NiconicoLoginOption {
    cookiesText: string;
}

export interface NiconicoLoginResult {
    status: 'connected';
    account?: NiconicoAccountInfo;
}

export interface NiconicoCommentOption {
    channelId: ChannelId;
    text: string;
    color: string;
    position: JikkyoCommentPosition;
    size: JikkyoCommentSize;
}

export type DiscordNotificationEvent =
    'recording_start' | 'recording_finish' | 'recording_failed' | 'encode_finish' | 'encode_failed';

export interface DiscordNotificationDestination {
    id: string;
    name: string;
    username: string;
    configured: boolean;
}

export interface DiscordNotificationCondition {
    dropMin?: number;
    dropMax?: number;
    errorMin?: number;
    errorMax?: number;
    scramblingMin?: number;
    scramblingMax?: number;
}

export interface DiscordNotificationRule {
    id: string;
    name: string;
    enabled: boolean;
    event: DiscordNotificationEvent;
    destinationId: string;
    message: string;
    condition?: DiscordNotificationCondition;
}

export interface DiscordNotificationSettings {
    enabled: boolean;
    destinations: DiscordNotificationDestination[];
    rules: DiscordNotificationRule[];
}

export interface UpdateDiscordNotificationDestination {
    id: string;
    name: string;
    username: string;
    webhookUrl?: string;
    clearWebhook?: boolean;
}

export interface UpdateDiscordNotificationSettings {
    enabled: boolean;
    destinations: UpdateDiscordNotificationDestination[];
    rules: DiscordNotificationRule[];
}

export interface TestDiscordNotificationOption {
    destinationId: string;
}

export type JikkyoCommentPosition = 'top' | 'right' | 'bottom';
export type JikkyoCommentSize = 'big' | 'medium' | 'small';

export interface RecordedJikkyoComment {
    id: number;
    time: number;
    text: string;
    color: string;
    position: JikkyoCommentPosition;
    size: JikkyoCommentSize;
    userId: string;
    postedAt: number;
}

export interface RecordedJikkyoComments {
    isSuccess: boolean;
    comments: RecordedJikkyoComment[];
    detail: string;
}

/**
 * 手動予約編集オプション
 */
export interface EditManualReserveOption {
    allowEndLack: boolean; // 末尾切れを許すか
    userId?: UserId;
    tags?: RecordedTagId[];
    saveOption?: ReserveSaveOption;
    encodeOption?: ReserveEncodedOption;
}

/**
 * 手動予約オプション
 */
export interface ManualReserveOption extends EditManualReserveOption {
    programId?: ProgramId; // program ID undefined の場合は時刻指定予約
    userId?: UserId;
    timeSpecifiedOption?: {
        name: string;
        channelId: ChannelId;
        startAt: UnixtimeMS;
        endAt: UnixtimeMS;
    };
}

/**
 * 予約情報取得タイプ
 */
export type GetReserveType = 'all' | 'normal' | 'conflict' | 'skip' | 'overlap';

/**
 * 予約情報取得オプション
 */
export interface GetReserveOption {
    type?: GetReserveType;
    isHalfWidth: boolean;
    ruleId?: RuleId;
    userId?: UserId;
    offset?: number;
    limit?: number;
}

/**
 * 予約情報
 */
export interface Reserves {
    reserves: ReserveItem[];
    total: number;
}

/**
 * 予約番組情報
 */
export interface ReserveItem {
    /**
     * 予約情報
     */
    id: ReserveId;
    userId?: UserId;
    ruleId?: RuleId;
    isSkip: boolean;
    isConflict: boolean;
    isOverlap: boolean;
    allowEndLack: boolean;
    isTimeSpecified: boolean;
    tags?: RecordedTagId[];
    /**
     * 保存オプション
     */
    parentDirectoryName?: string;
    directory?: string;
    recordedFormat?: string;
    /**
     * エンコード情報
     */
    encodeMode1?: string;
    encodeParentDirectoryName1?: string;
    encodeDirectory1?: string;
    encodeMode2?: string;
    encodeParentDirectoryName2?: string;
    encodeDirectory2?: string;
    encodeMode3?: string;
    encodeParentDirectoryName3?: string;
    encodeDirectory3?: string;
    isDeleteOriginalAfterEncode: boolean;
    updateThumbnail?: boolean;
    /**
     * 番組情報
     */
    programId?: ProgramId;
    channelId: ChannelId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    name: string;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
    videoType?: ProgramVideoType;
    videoResolution?: ProgramVideoResolution;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: ProgramAudioSamplingRate;
    audioComponentType?: number;
}

/**
 * 予約情報のリスト取得オプション
 */
export interface GetReserveListsOption {
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
}

/**
 * 予約情報のリスト
 * 予約, 除外, 重複, 競合の reserveId リスト
 */
export interface ReserveLists {
    normal: ReserveListItem[];
    conflicts: ReserveListItem[];
    skips: ReserveListItem[];
    overlaps: ReserveListItem[];
}

/**
 * 予約リストitem
 */
export interface ReserveListItem {
    reserveId: ReserveId;
    programId?: ProgramId;
    ruleId?: RuleId;
}

export interface ReserveCnts {
    normal: number;
    conflicts: number;
    skips: number;
    overlaps: number;
}

/**
 * 放送波の状態
 * true のもが有効
 */
export interface BroadcastStatus {
    [key: string]: boolean;
    GR: boolean;
    BS: boolean;
    CS: boolean;
    SKY: boolean;
}

/**
 * Rule
 */
export interface Rule extends AddRuleOption {
    id: RuleId;
    reservesCnt?: number;
    annictId?: number;
}

export interface RuleKeywordItem {
    id: RuleId;
    keyword: string;
}

/**
 * ルールのキーワード検索結果
 */
export interface RuleKeywordInfo {
    items: RuleKeywordItem[];
}

/**
 * Rule 追加オプション
 */
export interface AddRuleOption {
    isTimeSpecification: boolean;
    userId?: UserId;
    searchOption: RuleSearchOption;
    reserveOption: RuleReserveOption;
    saveOption?: ReserveSaveOption;
    encodeOption?: ReserveEncodedOption;
}

/**
 * ジャンル
 */
export interface Genre {
    genre: ProgramGenreLv1;
    subGenre?: ProgramGenreLv2;
}

/**
 * 時刻指定
 * program id 予約の場合は動画の長さ
 * 時刻指定予約の場合は時刻範囲 (0 ~  60 * 24)
 */
export interface SearchTime {
    // program id 予約の場合は 0 ~ 23 時の開始時刻を指定する
    // 時刻予約の場合は 0 時を 0 とした 0 ~ (60 * 50 * 24) - 1 秒までの開始時刻を指定する
    start?: number;
    // program id 予約の場合は 1 ~ 23 時間の長さを指定する
    // 時刻予約の場合は秒で時間の長さを指定する 1 ~ 60 * 50 * 24 秒
    range?: number;
    // 曜日指定 0x01, 0x02, 0x04, 0x08, 0x10, 0x20 ,0x40 が日〜土に対応するので and 演算で曜日を指定する
    week: number;
}

/**
 * 検索期間指定
 */
export interface SearchPeriod {
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
}

/**
 * Rule 検索オプション
 */
export interface RuleSearchOption {
    keyword?: string; // 検索キーワード
    ignoreKeyword?: string; // 除外検索キーワード
    keyCS?: boolean; // 大文字小文字区別有効化 (検索キーワード)
    keyRegExp?: boolean; // 正規表現 (検索キーワード)
    name?: boolean; // 番組名 (検索キーワード)
    description?: boolean; // 概要 (検索キーワード)
    extended?: boolean; // 詳細 (検索キーワード)
    ignoreKeyCS?: boolean; // 大文字小文字区別有効化 (除外検索キーワード)
    ignoreKeyRegExp?: boolean; // 正規表現 (除外検索キーワード)
    ignoreName?: boolean; // 番組名 (除外検索キーワード)
    ignoreDescription?: boolean; // 概要 (除外検索キーワード)
    ignoreExtended?: boolean; // 詳細 (除外検索キーワード)
    GR?: boolean; // GR
    BS?: boolean; // BS
    CS?: boolean; // CS
    SKY?: boolean; // SKY
    channelTypes?: ChannelType[]; // GR-ALT などの追加 channel type
    channelIds?: ChannelId[]; // channels ids
    genres?: Genre[];
    times?: SearchTime[]; // 開始時間からの有効時間
    isFree?: boolean; // 無料放送か
    durationMin?: number; // 番組最小時間
    durationMax?: number; // 番組最大時間
    searchPeriods?: SearchPeriod[]; // 検索対象期間
}

/**
 * ルール予約オプション
 */
export interface RuleReserveOption {
    enable: boolean; // ルールが有効か
    allowEndLack: boolean; // 末尾切れを許可するか
    avoidDuplicate: boolean; // 録画済みの重複番組を排除するか
    periodToAvoidDuplicate?: number; // 重複を避ける期間
    tags?: RecordedTagId[]; // 録画完了後に付与する tag 設定
}

/**
 * 保存オプション
 */
export interface ReserveSaveOption {
    parentDirectoryName?: string; // 親保存ディレクトリ
    directory?: string; // 保存ディレクトリ
    recordedFormat?: string; // ファイル名フォーマット
}

/**
 * エンコードオプション
 */
export interface ReserveEncodedOption {
    mode1?: string; // エンコードモード
    channelIds1?: ChannelId[]; // エンコードモード1対象局
    channelId1?: ChannelId; // エンコードモード1対象局
    encodeParentDirectoryName1?: string; // 親保存ディレクトリ
    directory1?: string; // 保存先ディレクトリ
    mode2?: string;
    channelIds2?: ChannelId[];
    channelId2?: ChannelId;
    encodeParentDirectoryName2?: string;
    directory2?: string;
    mode3?: string;
    channelIds3?: ChannelId[];
    channelId3?: ChannelId;
    encodeParentDirectoryName3?: string;
    directory3?: string;
    isDeleteOriginalAfterEncode: boolean;
    updateThumbnail?: boolean;
}

/**
 * ルール情報
 */
export interface Rules {
    rules: Rule[];
    total: number;
}

/**
 * ルール情報取得オプション
 */
export interface GetRuleOption {
    offset?: number;
    limit?: number;
    type?: GetReserveType;
    keyword?: string;
    hasReserve?: boolean;
    userId?: UserId;
}

/**
 * 録画一覧情報
 */
export interface Records {
    records: RecordedItem[];
    total: number;
}

/**
 * Recorded
 */
export interface RecordedItem {
    id: RecordedId;
    userId?: UserId;
    ruleId?: RuleId;
    programId?: ProgramId;
    channelId: ChannelId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    name: string;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
    videoType?: ProgramVideoType;
    videoResolution?: ProgramVideoResolution;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: ProgramAudioSamplingRate;
    audioComponentType?: number;
    isRecording: boolean;
    thumbnails?: ThumbnailId[];
    videoFiles?: VideoFile[];
    dropLogFile?: DropLogFile;
    tags?: RecordedTag[];
    isEncoding: boolean;
    isProtected: boolean;
}

/**
 * VideoFile
 */
export interface VideoFile {
    id: VideoFileId;
    name: string;
    filename: string;
    type: VideoFileType;
    size: number;
}

export interface VideoSubtitle {
    subtitleIndex: number;
    streamIndex: number;
    codecName?: string;
    language?: string;
    title?: string;
    isDefault: boolean;
    isForced: boolean;
    displayName: string;
}

export interface VideoSubtitles {
    items: VideoSubtitle[];
}

export interface VideoSubtitleText {
    subtitleText: string;
}

export interface VideoPreparedSubtitle {
    subtitleFileKey: string;
    subtitleText?: string;
}

export interface SubtitleTransferOption {
    sourceVideoFileId: VideoFileId;
    subtitleIndex: number;
    title: string;
}

export interface SubtitleRenameOption {
    title: string;
}

export interface SubtitleReorderOption {
    subtitleIndices: number[];
}

export type SubtitleTransferTaskStatus = 'running' | 'completed' | 'failed';

export interface SubtitleTransferTask {
    id: string;
    sourceVideoFileId: VideoFileId;
    targetVideoFileId: VideoFileId;
    subtitleIndex: number;
    title: string;
    status: SubtitleTransferTaskStatus;
    error?: string;
    createdAt: UnixtimeMS;
    updatedAt: UnixtimeMS;
}

export interface DropLogFile {
    id: DropLogFileId;
    errorCnt: number;
    dropCnt: number;
    scramblingCnt: number;
}

/**
 * Recorded tag
 */
export interface RecordedTag {
    id: RecordedTagId;
    name: string;
    color: string;
}

export interface RecordedTags {
    tags: RecordedTag[];
    total: number;
}

export type RecordedEncodeModeMatch = 'include' | 'only';

/**
 * recorded 取得オプション
 */
export interface GetRecordedOption {
    isHalfWidth: boolean;
    offset?: number;
    limit?: number;
    isReverse?: boolean;
    ruleId?: RuleId;
    channelId?: ChannelId;
    genre?: ProgramGenreLv1;
    keyword?: string;
    hasOriginalFile?: boolean;
    encodeMode?: string;
    encodeModes?: string[];
    encodeModeMatch?: RecordedEncodeModeMatch;
    hasDrop?: boolean;
    hasError?: boolean;
    hasScrambling?: boolean;
    recordedStartAt?: UnixtimeMS;
    recordedEndAt?: UnixtimeMS;
    userId?: UserId;
}

export interface User {
    id: UserId;
    name: string;
    createdAt: UnixtimeMS;
}

export interface Users {
    users: User[];
}

export interface AddUserOption {
    name: string;
}

export interface UpdateUserOption {
    name: string;
}

export interface UpdateRecordedUserOption {
    userId: UserId;
}

export interface BulkUpdateRecordedUserOption {
    recordedIds: RecordedId[];
    userId: UserId;
}

export interface MoveRecordedSubDirectoryOption {
    recordedIds: RecordedId[];
    subDirectory: string;
}

export interface RecordedSubDirectories {
    directories: string[];
}

export interface BulkRecordedOperationResult {
    updatedCount: number;
    movedFileCount: number;
}

/**
 * recorded が持つ channelId のリスト
 */
export interface RecordedChannelListItem {
    cnt: number; // 個数
    channelId: ChannelId; // 放送局 id
}

/**
 * recorded が持つ genre のリスト
 */
export interface RecordedGenreListItem {
    cnt: number; // 個数
    genre: ProgramGenreLv1; // ジャンル
}

export interface RecordedEncodeListItem {
    name: string; // config encode の name
    suffix?: string; // config encode の suffix
}

/**
 * recorded が持つ検索オプションリスト
 */
export interface RecordedSearchOptions {
    channels: RecordedChannelListItem[];
    genres: RecordedGenreListItem[];
    encode: RecordedEncodeListItem[];
}

export interface RecordedCleanupPlanResult {
    planPath: string;
    recordedFileCount: number;
    epgstationLikeRecordedFileCount: number;
    otherRecordedFileCount: number;
    recordedDirectoryCount: number;
    missingVideoFileCount: number;
    dropLogFileCount: number;
    missingDropLogFileCount: number;
    thumbnailFileCount: number;
    missingThumbnailFileCount: number;
}

export interface RecordedCleanupExecuteOption {
    planPath: string;
}

export interface RecordedCleanupExecuteResult {
    deletedRecordedFileCount: number;
    deletedRecordedDirectoryCount: number;
    deletedDropLogFileCount: number;
    deletedThumbnailFileCount: number;
    removedMissingVideoFileCount: number;
    removedMissingDropLogFileCount: number;
    removedMissingThumbnailFileCount: number;
    skippedCount: number;
}

/**
 * tag 取得オプション
 */
export interface GetRecordedTagOption {
    offset?: number;
    limit?: number;
    name?: string;
    excludeTagId?: RecordedTagId[];
}

/**
 * URL Scheme 情報
 */
export interface URLSchemeInfo {
    ios?: string;
    android?: string;
    mac?: string;
    win?: string;
}

export interface M2TSStreamParam {
    name: string;
    isUnconverted: boolean; // 無変換か
}

/**
 * クライアントが受け取る設定情報
 */
export interface Config {
    socketIOPort: number;
    broadcast: BroadcastStatus;
    recorded: string[];
    encode: string[];
    urlscheme: {
        m2ts: URLSchemeInfo;
        video: URLSchemeInfo;
        download: URLSchemeInfo;
    };
    isEnableTSLiveStream: boolean;
    isEnableTSRecordedStream: boolean;
    isEnableEncodedRecordedStream: boolean;
    developerMode?: boolean;
    streamConfig?: {
        live?: {
            ts?: {
                m2ts?: M2TSStreamParam[];
                m2tsll?: string[];
                webm?: string[];
                mp4?: string[];
                hls?: string[];
            };
        };
        recorded?: {
            ts?: {
                m2tsll?: string[];
                webm?: string[];
                mp4?: string[];
                hls?: string[];
            };
            encoded?: {
                webm?: string[];
                mp4?: string[];
                hls?: string[];
            };
        };
    };
    watchConfig?: WatchConfig;
    kodiHosts?: string[];
}

export interface WatchConfig {
    enabled: boolean;
    encoder: 'FFmpeg' | 'QSVEncC' | 'NVEncC' | 'VCEEncC';
    availableEncoders: ('FFmpeg' | 'QSVEncC' | 'NVEncC' | 'VCEEncC')[];
    defaultLiveQuality?: string;
    defaultRecordedQuality?: string;
    liveQualities: string[];
    recordedQualities: string[];
    hevc10bit: boolean;
    fps24: boolean;
}

/**
 * 放送波指定の番組表情報取得オプション
 */
export interface ScheduleOption {
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    isHalfWidth: boolean;
    needsRawExtended?: boolean;
    isFree?: boolean;
    GR: boolean;
    BS: boolean;
    CS: boolean;
    SKY: boolean;
    channelTypes?: ChannelType[];
}

/**
 * チャンネル指定の番組情報取得オプション
 */
export interface ChannelScheduleOption {
    startAt: UnixtimeMS;
    days: number; // 取得日数
    isHalfWidth: boolean;
    needsRawExtended?: boolean;
    isFree?: boolean;
    channelId: ChannelId;
}

export interface BroadcastingScheduleOption {
    time?: UnixtimeMS; // 追加時間 (ms)
    isHalfWidth: boolean;
}

/**
 * 番組表の放送局データ
 */
export interface ScheduleChannleItem {
    id: ChannelId;
    serviceId: ServiceId;
    networkId: NetworkId;
    name: string;
    remoteControlKeyId?: number;
    hasLogoData: boolean;
    channelType: ChannelType;
    type?: number;
}

/**
 * 番組表の番組データ
 */
export interface ScheduleProgramItem {
    id: ProgramId;
    channelId: ChannelId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    isFree: boolean;
    name: string;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
    videoType?: ProgramVideoType;
    videoResolution?: ProgramVideoResolution;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: ProgramAudioSamplingRate;
    audioComponentType?: number;
}

/**
 * 番組表データ
 */
export interface Schedule {
    channel: ScheduleChannleItem;
    programs: ScheduleProgramItem[];
}

/**
 * 番組検索オプション
 */
export interface ScheduleSearchOption {
    option: RuleSearchOption;
    isHalfWidth: boolean;
    limit?: number;
}

/**
 * Encode
 */

/**
 * エンコード情報
 */
export interface EncodeInfo {
    runningItems: EncodeProgramItem[]; // エンコード中
    waitItems: EncodeProgramItem[]; // エンコード待ち
}

export interface EncodeQueueOrderOption {
    encodeIds: EncodeId[];
    expectedEncodeIds: EncodeId[];
}

export interface EncodeProgramItem {
    id: EncodeId;
    mode: string;
    recorded: RecordedItem;
    percent?: number;
    log?: string;
}

/**
 * エンコード追加オプション
 */
export interface AddEncodeProgramOption {
    recordedId: RecordedId;
    sourceVideoFileId: VideoFileId;
    parentDir: string; // 親ディレクトリ config recorded の name
    directory?: string; // 親ディレクトリ以下のディレクトリ設定
    mode: string; // config encode の name
    removeOriginal: boolean;
    updateThumbnail?: boolean;
}

export interface AddManualEncodeProgramOption {
    recordedId: RecordedId;
    sourceVideoFileId: VideoFileId;
    parentDir?: string; // isSaveSameDirectory が false の場合は必須
    directory?: string;
    isSaveSameDirectory?: boolean; // ソースビデオファイルと同じ場所に保存する
    mode: string; // config encode の name
    removeOriginal: boolean;
    updateThumbnail?: boolean;
}

/**
 * ライブストリームオプション
 */
export interface LiveStreamOption {
    channelId: ChannelId;
    mode: number; // config 設定
    quality?: string;
    encoder?: 'FFmpeg' | 'QSVEncC' | 'NVEncC' | 'VCEEncC';
    isHevc?: boolean;
}

export interface RecordedStreanOption {
    videoFileId: VideoFileId;
    playPosition: number; // 再生位置 (秒)
    mode: number; // config 設定
    vodSessionId?: string; // VOD HLS 視聴クライアント識別子
    quality?: string;
    encoder?: 'FFmpeg' | 'QSVEncC' | 'NVEncC' | 'VCEEncC';
    isHevc?: boolean;
    subtitleIndex?: number;
    subtitleFileKey?: string;
    subtitleSize?: number;
    subtitleOpacity?: number;
    subtitleOutlineSize?: number;
    subtitleOutlineOpacity?: number;
}
/**
 * ライブストリーム情報
 */
export interface LiveStreamInfoItem {
    streamId: StreamId;
    type: StreamType;
    mode: number;
    isEnable: boolean;
    channelId: ChannelId;
    name: string;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
}

/**
 * ビデオファイルストリーム情報
 */
export interface VideoFileStreamInfoItem extends LiveStreamInfoItem {
    viodeFileId: VideoFileId;
    recordedId: RecordedId;
}

/**
 * アップロードするビデオ情報
 */
export interface UploadVideoFileOption {
    recordedId: RecordedId; // 紐付ける recorded id
    parentDirectoryName: string; // 保存先ディレクトリ名
    subDirectory?: string; // 保存先サブディレクトリ
    viewName: string; // UI 上での表示名
    fileType: VideoFileType; // ファイルタイプ
    file: File; // ファイル
}

/**
 * 新規追加する録画番組情報
 */
export interface CreateNewRecordedOption {
    ruleId?: RuleId;
    userId?: UserId;
    channelId: ChannelId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    name: string;
    description?: string;
    extended?: string;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
}

/**
 * ストリーム情報
 */
export interface StreamInfo {
    items: (LiveStreamInfoItem | VideoFileStreamInfoItem)[];
}

/**
 * ディスク使用情報
 */
export interface DiskUsage {
    available: number;
    used: number;
    total: number;
}

/**
 * ディスク使用状況 + 名称
 */
export interface StorageItem extends DiskUsage {
    name: string;
    breakdownPending?: boolean;
    breakdown: StorageBreakdown;
}

export interface StorageBreakdown {
    recorded: number;
    dropLogs: number;
    thumbnails: number;
    other: number;
}

export interface SystemCpuInfo {
    model: string;
    logicalCores: number;
    usagePercent: number;
}

export interface SystemMemoryInfo extends DiskUsage {
    usagePercent: number;
}

export interface SystemGpuInfo {
    name: string;
    usagePercent?: number;
    memoryTotal?: number;
    memoryUsed?: number;
}

export interface SystemProcessInfo {
    pid: number;
    uptime: number;
    memoryUsed: number;
}

export interface SystemResourceInfo {
    hostname: string;
    platform: string;
    arch: string;
    containerRuntime?: 'docker'; // コンテナ実行環境
    uptime: number;
    sampledAt: number;
    cpu: SystemCpuInfo;
    memory: SystemMemoryInfo;
    process: SystemProcessInfo;
}

export interface SystemGpuList {
    items: SystemGpuInfo[];
    sampledAt: number;
}

export type SystemStorageVolumeType = 'fixed' | 'removable' | 'network' | 'other';

export interface SystemStorageVolume extends DiskUsage {
    id: string;
    name: string;
    path: string;
    type: SystemStorageVolumeType;
}

export interface SystemStorageVolumeList {
    items: SystemStorageVolume[];
    sampledAt: number;
}

export type SystemLogSource = 'Operator' | 'Service' | 'EPGUpdater';
export type SystemLogCategory = 'system' | 'access' | 'stream' | 'encode';
export type SystemLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'off';

export interface SystemLogLevelSetting {
    source: SystemLogSource;
    category: SystemLogCategory;
    level: SystemLogLevel;
}

export interface SystemLogInfo {
    source: SystemLogSource;
    category: SystemLogCategory;
    level: SystemLogLevel;
    fileName: string;
    exists: boolean;
    size: number;
    updatedAt?: number;
    lines: string[];
    truncated: boolean;
}

export interface SystemMirakurunChannel {
    type: ChannelType;
    channel: string;
    name?: string;
}

export interface SystemMirakurunTunerUser {
    id: string;
    priority: number;
    agent?: string;
    url?: string;
    channel?: SystemMirakurunChannel;
    networkId?: number;
    serviceId?: number;
    eventId?: number;
    packetCount: number;
    dropCount: number;
}

export interface SystemMirakurunTuner {
    index: number;
    name: string;
    types: ChannelType[];
    pid: number;
    isAvailable: boolean;
    isRemote: boolean;
    isFree: boolean;
    isUsing: boolean;
    isFault: boolean;
    users: SystemMirakurunTunerUser[];
}

export interface SystemMirakurunInfo {
    connected: boolean;
    sampledAt: number;
    responseTimeMs: number;
    version?: string;
    error?: string;
    epg?: {
        gatheringNetworks: number[];
        storedEvents: number;
    };
    streamCount?: {
        tunerDevice: number;
        tsFilter: number;
        decoder: number;
    };
    errorCount?: {
        uncaughtException: number;
        unhandledRejection: number;
        bufferOverflow: number;
        tunerDeviceRespawn: number;
        decoderRespawn: number;
    };
    tuners: SystemMirakurunTuner[];
}

/**
 * ディスク情報
 */
export interface StorageInfo {
    items: StorageItem[];
    system: SystemResourceInfo;
}

/**
 * バージョン情報
 */
export interface VersionInfo {
    version: string;
}

export type SystemUpdateTarget = 'stable' | 'develop';
export type SystemUpdatePackageManager = 'auto' | 'npm' | 'pnpm';
export type SystemUpdateJobStatus = 'running' | 'success' | 'failed' | 'rolled-back' | 'rollback-failed';

export interface SystemUpdateRemoteTarget {
    label: string;
    version: string | null;
    tag: string | null;
    commit: string;
}

export interface SystemUpdateJob {
    id: string;
    target: SystemUpdateTarget;
    packageManager: SystemUpdatePackageManager;
    status: SystemUpdateJobStatus;
    stage: string;
    startedAt: number;
    finishedAt: number | null;
    installRan: boolean;
    restartRequired: boolean;
    rollback: 'none' | 'running' | 'success' | 'failed';
    logs: string[];
    error: string | null;
    command: string | null;
    exitCode: number | null;
    timedOut: boolean;
    stashCommit: string | null;
}

export interface SystemUpdateInfo {
    version: string;
    commit: string | null;
    branch: string | null;
    currentTag: string | null;
    isGitRepository: boolean;
    isClean: boolean;
    gitError: string | null;
    dirtyFiles: string[];
    packageManager: Exclude<SystemUpdatePackageManager, 'auto'>;
    rememberedPackageManager: Exclude<SystemUpdatePackageManager, 'auto'> | null;
    targets: {
        stable: SystemUpdateRemoteTarget | null;
        develop: SystemUpdateRemoteTarget | null;
        checkedAt: number;
        error: string | null;
    };
    hasStableUpdate: boolean;
    job: SystemUpdateJob | null;
}

export interface StartSystemUpdateOption {
    target: SystemUpdateTarget;
    packageManager: SystemUpdatePackageManager;
    preserveLocalChanges: boolean;
}
