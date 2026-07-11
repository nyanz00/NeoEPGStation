import * as apid from '../../../../api';

export default interface IJikkyoApiModel {
    getRecordedComments(recordedId: apid.RecordedId): Promise<apid.RecordedJikkyoComments>;
}
