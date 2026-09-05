import * as apid from '../../../../api';
import { AddEncodeOption } from './IEncoderModel';

export interface EncodeRecordedIdIndex {
    [recordedId: number]: {
        encodeId: apid.EncodeId;
        name: string;
    }[];
}

export interface EncodeQueueInfo {
    runningQueue: EncodeInfoItem[];
    waitQueue: EncodeInfoItem[];
    scheduledQueue: EncodeInfoItem[];
}

export interface EncodeInfoItem {
    id: apid.EncodeId;
    mode: string;
    recordedId: apid.RecordedId;
    percent?: number;
    log?: string;
    scheduledAt?: number;
}

export default interface IEncodeManageModel {
    push(addOption: AddEncodeOption): Promise<apid.EncodeId>;
    cancel(encodeId: apid.EncodeId): Promise<void>;
    reorderWaitQueue(encodeIds: apid.EncodeId[], expectedEncodeIds: apid.EncodeId[]): Promise<void>;
    getRecordedIndex(): EncodeRecordedIdIndex;
    cancelEncodeByRecordedId(recordedId: apid.RecordedId): Promise<void>;
    getEncodeInfo(): EncodeQueueInfo;
}
