import * as http from 'http';

export type RecordedPlaybackHistoryUpdate =
    | { userId: number; settings?: boolean; recordedIds?: never }
    | { recordedIds: number[]; userId?: never; settings?: never };

export default interface ISocketIOManageModel {
    initialize(servers: http.Server[]): void;
    notifyClient(recordedId?: number): void;
    notifyRecordedPlaybackHistory(userId: number, settings?: boolean): void;
    notifyUpdateEncodeProgress(): void;
}
