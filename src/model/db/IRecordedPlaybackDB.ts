import RecordedPlayback from '../../db/entities/RecordedPlayback';

export interface RecordedPlaybackUpdate {
    position: number;
    duration: number;
    watchedSecondsDelta: number;
    observedAt: number;
    historyLimit: number;
    historyEnabled: boolean;
}

export default interface IRecordedPlaybackDB {
    find(recordedId: number, userId: number): Promise<RecordedPlayback | null>;
    findHistory(userId: number, limit: number): Promise<RecordedPlayback[]>;
    trimHistory(userId: number, limit: number): Promise<void>;
    removeFromHistory(recordedId: number, userId: number): Promise<void>;
    deleteRecordedId(recordedId: number): Promise<void>;
    update(recordedId: number, userId: number, value: RecordedPlaybackUpdate): Promise<RecordedPlayback>;
}
