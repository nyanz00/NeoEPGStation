import * as apid from '../../../../api';
import VideoFile from '../../../db/entities/VideoFile';
export interface VideoInfo {
    duration: number; // sec
    size: number; // byte
    bitRate: number; // bps
    videoCodecName?: string;
    videoPixelFormat?: string;
}

export interface VideoSubtitleInfo {
    subtitleIndex: number;
    streamIndex: number;
    codecName?: string;
    language?: string;
    title?: string;
    isDefault: boolean;
    isForced: boolean;
    displayName: string;
}

export interface PreparedSubtitleInfo {
    key: string;
    filePath: string;
}

export interface SubtitleTextRange {
    startAt: number;
    duration: number;
}

export interface VideoRecordingTimeInfo {
    startAt: number;
    endAt: number;
    duration: number;
}

export default interface IVideoUtil {
    getFullFilePathFromId(videoFileId: apid.VideoFileId): Promise<string | null>;
    getFullFilePathFromVideoFile(videoFile: VideoFile): string | null;
    getParentDirPath(name: string): string | null;
    getInfo(filePath: string): Promise<VideoInfo>;
    getMpegTsRecordingTime(filePath: string): Promise<VideoRecordingTimeInfo | null>;
    getMpegTsServiceId(filePath: string): Promise<number | null>;
    getSubtitles(filePath: string): Promise<VideoSubtitleInfo[]>;
    getSubtitleText(filePath: string, subtitleIndex: number, range?: SubtitleTextRange): Promise<string>;
    prepareSubtitle(filePath: string, subtitleIndex: number): Promise<PreparedSubtitleInfo>;
    getPreparedSubtitlePath(key: string): string | undefined;
}
