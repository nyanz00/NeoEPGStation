import * as apid from '../../../../api.js';

export default interface IJikkyoApiModel {
    getRecordedComments(
        recordedId: apid.RecordedId,
        videoFileId: apid.VideoFileId,
    ): Promise<apid.RecordedJikkyoComments>;
}
