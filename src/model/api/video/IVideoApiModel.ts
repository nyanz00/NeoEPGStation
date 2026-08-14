import * as apid from '../../../../api';
import IPlayList from '../IPlayList';
import { VideoRecordingTimeInfo } from './IVideoUtil';

export interface VideoFilePathInfo {
    path: string;
    mime: string;
}

export default interface IVideoApiModel {
    getFullFilePath(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null>;
    getWebPlaybackFilePath(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null>;
    getM3u8(host: string, isSecure: boolean, videoFileId: apid.VideoFileId): Promise<IPlayList | null>;
    deleteVideoFile(videoFileId: apid.VideoFileId): Promise<void>;
    getDuration(videoFileId: apid.VideoFileId): Promise<number>;
    getMpegTsRecordingTime(videoFileId: apid.VideoFileId): Promise<VideoRecordingTimeInfo | null>;
    getSubtitles(videoFileId: apid.VideoFileId): Promise<apid.VideoSubtitles>;
    getSubtitleText(videoFileId: apid.VideoFileId, subtitleIndex: number): Promise<apid.VideoSubtitleText>;
    prepareSubtitle(videoFileId: apid.VideoFileId, subtitleIndex: number): Promise<apid.VideoPreparedSubtitle>;
    startSubtitleTransfer(
        targetVideoFileId: apid.VideoFileId,
        option: apid.SubtitleTransferOption,
    ): Promise<apid.SubtitleTransferTask>;
    startSubtitleRename(
        videoFileId: apid.VideoFileId,
        subtitleIndex: number,
        option: apid.SubtitleRenameOption,
    ): Promise<apid.SubtitleTransferTask>;
    startSubtitleReorder(
        videoFileId: apid.VideoFileId,
        option: apid.SubtitleReorderOption,
    ): Promise<apid.SubtitleTransferTask>;
    getSubtitleTransferTask(targetVideoFileId: apid.VideoFileId, taskId: string): Promise<apid.SubtitleTransferTask>;
    sendToKodi(host: string, isSecure: boolean, kodiName: string, videoFileId: apid.VideoFileId): Promise<void>;
}
