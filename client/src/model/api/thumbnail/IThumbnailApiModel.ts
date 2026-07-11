import * as apid from '../../../../../api';

export default interface IThumbnailApiModel {
    cleanup(): Promise<void>;
    replace(videoFileId: apid.VideoFileId): Promise<void>;
}
