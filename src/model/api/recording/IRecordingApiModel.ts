import * as apid from '../../../../api';

export default interface IRecordingApiModel {
    gets(option: apid.GetRecordedOption): Promise<apid.Records>;
    getDropStatus(): Promise<apid.RecordingDropLogStatus[]>;
    stop(recordedId: apid.RecordedId): Promise<void>;
    resetTimer(): Promise<void>;
}
