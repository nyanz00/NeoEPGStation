import * as apid from '../../../../api.js';

export default interface IVideoCommentApiModel {
    getComments(videoFileId: apid.VideoFileId, subtitleIndex?: number): Promise<apid.VideoComments>;
}
