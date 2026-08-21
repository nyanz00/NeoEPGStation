import * as apid from '../../../../api';
import { UploadedVideoFileOption } from '../../operator/recorded/IRecordedManageModel';

export default interface IRecordedApiModel {
    gets(option: apid.GetRecordedOption): Promise<apid.Records>;
    get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem | null>;
    getListPosition(recordedId: apid.RecordedId, limit: number): Promise<apid.RecordedListPosition>;
    getSearchOptionList(): Promise<apid.RecordedSearchOptions>;
    delete(recordedId: apid.RecordedId): Promise<void>;
    stopEncode(recordedId: apid.RecordedId): Promise<void>;
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    changeUser(recordedId: apid.RecordedId, option: apid.UpdateRecordedUserOption): Promise<void>;
    bulkChangeUser(option: apid.BulkUpdateRecordedUserOption): Promise<apid.BulkRecordedOperationResult>;
    getSubDirectories(): Promise<apid.RecordedSubDirectories>;
    moveToSubDirectory(option: apid.MoveRecordedSubDirectoryOption): Promise<apid.BulkRecordedOperationResult>;
    getLatestCleanupPlan(): Promise<apid.RecordedCleanupPlanResult | null>;
    createCleanupPlan(): Promise<apid.RecordedCleanupPlanResult>;
    executeCleanupPlan(planPath: string): Promise<apid.RecordedCleanupExecuteResult>;
    fileCleanup(): Promise<void>;
    addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void>;
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
}
