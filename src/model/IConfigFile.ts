import * as apid from '../../api';
import * as Enums from '../Enums';

export interface HttpsConfig {
    port: number;
    key: string; // 秘密鍵
    cert: string; // 証明書
    ca?: string | string[]; // クライアント認証用秘密鍵
    socketioPort?: number;
}

export interface TailscaleHttpsConfig {
    enabled: boolean;
    port: number;
    socketioPort?: number;
    hostname?: string;
    tailscalePath?: string;
    certificateDirectory?: string;
    renewBeforeDays?: number;
    checkIntervalHours?: number;
}

export interface RecordedDirInfo {
    name: string;
    path: string;
    limitThreshold?: number; // 空き容量限界閾値 (MB)
    action?: 'remove' | 'none'; // 空き容量限界値を超えたときの動作
    limitCmd?: string; // 空き容量限界値を超えたときに実行するコマンド
}

export interface URLSchemeInfo {
    ios?: string;
    android?: string;
    mac?: string;
    win?: string;
}

export interface StreamingCmd {
    name: string;
    cmd?: string;
}

export type WatchStreamEncoder = 'FFmpeg' | 'QSVEncC' | 'NVEncC' | 'VCEEncC';

export interface WatchStreamQuality {
    isHevc?: boolean;
    is60fps?: boolean;
    width: number;
    height: number;
    videoBitrate: string;
    videoBitrateMax?: string;
    audioBitrate: string;
}

export interface WatchStreamConfig {
    enabled?: boolean;
    encoder?: WatchStreamEncoder;
    encoderPath?: string;
    tsreadex?: string;
    qsvEncC?: string;
    nvEncC?: string;
    nvencc?: string;
    vceEncC?: string;
    defaultLiveQuality?: string;
    defaultRecordedQuality?: string;
    liveQualities?: string[];
    recordedQualities?: string[];
    hevc10bit?: boolean;
    fps24?: boolean;
    qualities?: { [quality: string]: WatchStreamQuality };
}

export interface KodiInfo {
    name: string;
    host: string;
    user?: string;
    password?: string;
}

export interface AmatsukazeEncodeConfig {
    addTaskPath?: string;
    root?: string;
    profile?: string;
    ip?: string;
    port?: number;
    priority?: number;
    outputDirMode?: 'encode' | 'source';
    outputDir?: string;
    temporaryOutputDir?: string;
    procMode?: 'batch' | 'auto' | 'test' | 'drcs' | 'cm';
    noMove?: boolean;
    waitForOutput?: boolean;
    waitIntervalSec?: number;
    finishDelaySec?: number;
    stableSec?: number;
    outputExtension?: string;
    outputNameMatch?: 'exact' | 'prefix';
    pendingTimeoutSec?: number;
}

/**
 * config ファイル形式
 */
export default interface IConfigFile {
    port?: number;
    socketioPort?: number;
    clientSocketioPort?: number;
    https?: HttpsConfig;
    tailscaleHttps?: TailscaleHttpsConfig;
    mirakurunPath: string;

    subDirectory?: string;

    uid?: number | string; // uid
    gid?: number | string; // gid

    apiServers: string[];

    isAllowAllCORS: boolean;

    dbtype: Enums.DBType;
    sqlite?: {
        extensions?: string[];
        regexp?: boolean;
    };
    mysql?: {
        host: string;
        user: string;
        port: number;
        password: string;
        database: string;
        charset?: string;
    };
    postgres?: {
        host: string;
        user: string;
        port: number;
        database: string;
        password: string;
    };

    // 囲み文字を置換するか
    needToReplaceEnclosingCharacters: boolean;

    // epg 更新時間間隔 (分)
    epgUpdateIntervalTime: number;

    // 放送局並び順
    channelOrder?: apid.ChannelId[];
    sidOrder?: apid.ServiceId[];

    // 放送局除外設定
    excludeChannels?: apid.ChannelId[];
    excludeSids?: apid.ServiceId[];

    // 開発者向け設定を Web UI に表示する
    developerMode?: boolean;

    // priority 設定
    recPriority: number;
    conflictPriority: number;
    streamingPriority: number;

    // 時刻指定予約マージン
    timeSpecifiedStartMargin: number;
    timeSpecifiedEndMargin: number;

    // 録画ファイル名フォーマット
    recordedFormat: string;

    // 拡張子
    recordedFileExtension: string;

    // 録画ディレクトリ
    recorded: RecordedDirInfo[];
    // 録画一時ディレクトリ
    recordedTmp?: string;

    // 録画履歴保存期間
    recordedHistoryRetentionPeriodDays: number;

    // ストレージ空き容量チェック間隔 (秒)
    storageLimitCheckIntervalTime: number;

    // サムネイル
    thumbnail: string;
    thumbnailCmd: string;
    thumbnailSize: string;
    thumbnailPosition: number;

    // 放送局ロゴキャッシュ
    channelLogo: string;

    // drop log
    dropLog: string;
    isEnabledDropCheck: boolean; // drop check を有効にするか

    // upload
    uploadTempDir: string;

    // VOD HLS・Web 再生変換等の一時ファイル保存先
    temporaryDir?: string;

    ffmpeg: string;
    ffprobe: string;

    // エンコード設定
    encodeProcessNum: number; // エンコード、ストリーミング最大プロセス数
    concurrentEncodeNum: number; // 同時エンコード数
    amatsukaze?: AmatsukazeEncodeConfig;
    encode: {
        name: string;
        cmd?: string;
        type?: 'command' | 'amatsukaze';
        amatsukaze?: AmatsukazeEncodeConfig;
        suffix?: string; // 非エンコードコマンドの場合 undefined
        rate?: number;
    }[];

    // 予約定期更新時のログ出力を抑えるか
    isSuppressReservesUpdateAllLog: boolean;

    // 各種フックコマンド
    reserveNewAddtionCommand?: string; // 予約新規追加
    reserveUpdateCommand?: string; // 予約情報更新
    reservedeletedCommand?: string; // 予約削除
    recordingPreStartCommand?: string; // 録画準備開始
    recordingPrepRecFailedCommand?: string; // 録画準備失敗
    recordingStartCommand?: string; // 録画開始
    recordingFinishCommand?: string; // 録画終了
    recordingFailedCommand?: string; // 録画中のエラー
    encodingFinishCommand?: string; // エンコード終了

    // 視聴 URL Scheme 設定
    urlscheme: {
        m2ts: URLSchemeInfo;
        video: URLSchemeInfo;
        download: URLSchemeInfo;
    };

    encodingFailedCommand?: string;

    streamFilePath: string;
    stream?: {
        live?: {
            ts?: {
                m2ts?: StreamingCmd[];
                m2tsll?: StreamingCmd[];
                webm?: StreamingCmd[];
                mp4?: StreamingCmd[];
                hls?: StreamingCmd[];
            };
        };
        recorded?: {
            ts?: {
                webm?: StreamingCmd[];
                mp4?: StreamingCmd[];
                hls?: StreamingCmd[];
            };
            encoded?: {
                webm?: StreamingCmd[];
                mp4?: StreamingCmd[];
                hls?: StreamingCmd[];
            };
        };
    };
    watch?: WatchStreamConfig;

    // 配信先 kodi 設定
    kodiHosts?: KodiInfo[];
}
