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
    recoveryQueue: EncodeRecoveryInfoItem[];
}

export interface EncodeInfoItem {
    id: apid.EncodeId;
    mode: string;
    recordedId: apid.RecordedId;
    percent?: number;
    log?: string;
    scheduledAt?: number;
}

export interface EncodeRecoveryInfoItem {
    id: apid.EncodeId;
    status: 'paused' | 'needs_attention';
    mode: string | null;
    recordedId: apid.RecordedId | null;
    reason: string;
    canRetry: boolean;
}

export default interface IEncodeManageModel {
    waitUntilReady(): Promise<void>;
    push(addOption: AddEncodeOption): Promise<apid.EncodeId>;
    cancel(encodeId: apid.EncodeId): Promise<void>;
    retry(encodeId: apid.EncodeId): Promise<void>;
    reorderWaitQueue(encodeIds: apid.EncodeId[], expectedEncodeIds: apid.EncodeId[]): Promise<void>;
    getRecordedIndex(): EncodeRecordedIdIndex;
    cancelEncodeByRecordedId(recordedId: apid.RecordedId): Promise<void>;
    cancelEncodeByVideoFileId(videoFileId: apid.VideoFileId): Promise<void>;
    withRecordedDeletion(recordedId: apid.RecordedId, action: () => Promise<void>): Promise<void>;
    withVideoFileDeletion(
        recordedId: apid.RecordedId,
        videoFileId: apid.VideoFileId,
        action: () => Promise<void>,
    ): Promise<void>;
    getEncodeInfo(): Promise<EncodeQueueInfo>;
}
