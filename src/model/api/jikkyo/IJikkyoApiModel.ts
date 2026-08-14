import * as apid from '../../../../api';

export default interface IJikkyoApiModel {
    getRecordedComments(
        recordedId: apid.RecordedId,
        videoFileId: apid.VideoFileId,
    ): Promise<apid.RecordedJikkyoComments>;
}
