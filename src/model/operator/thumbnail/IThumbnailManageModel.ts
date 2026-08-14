import * as apid from '../../../../api';

export default interface IThumbnailManageModel {
    add(videoFileId: apid.VideoFileId): void;
    addDuringRecording(videoFileId: apid.VideoFileId): void;
    stopDuringRecording(videoFileId: apid.VideoFileId): void;
    replace(videoFileId: apid.VideoFileId): void;
    delete(thumbnailId: apid.ThumbnailId): Promise<void>;
    regenerate(): Promise<void>;
    fileCleanup(): Promise<void>;
}
