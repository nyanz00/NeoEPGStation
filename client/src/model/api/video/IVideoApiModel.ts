import * as apid from '../../../../../api';

export default interface IVideoApiModel {
    delete(videoFileId: apid.VideoFileId): Promise<void>;
    getDuration(videoFileId: apid.VideoFileId): Promise<number>;
    getSubtitles(videoFileId: apid.VideoFileId): Promise<apid.VideoSubtitles>;
    getSubtitleText(videoFileId: apid.VideoFileId, subtitleIndex: number): Promise<apid.VideoSubtitleText>;
    prepareSubtitle(videoFileId: apid.VideoFileId, subtitleIndex: number): Promise<apid.VideoPreparedSubtitle>;
    sendToKodi(hostName: string, videoFileId: apid.VideoFileId): Promise<void>;
    uploadedVideoFile(option: apid.UploadVideoFileOption): Promise<void>;
}
