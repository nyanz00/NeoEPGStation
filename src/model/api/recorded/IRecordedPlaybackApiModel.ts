import * as apid from '../../../../api';

export default interface IRecordedPlaybackApiModel {
    get(recordedId: apid.RecordedId, userId: number): Promise<apid.RecordedPlayback>;
    getHistory(userId: number, isHalfWidth: boolean, limit: number): Promise<apid.RecordedPlaybackHistory>;
    getHistorySettings(userId: number): Promise<apid.RecordedPlaybackHistorySettings>;
    updateHistorySettings(
        userId: number,
        option: apid.RecordedPlaybackHistorySettings,
    ): Promise<apid.RecordedPlaybackHistorySettings>;
    removeFromHistory(recordedId: apid.RecordedId, userId: number): Promise<void>;
    update(
        recordedId: apid.RecordedId,
        userId: number,
        option: apid.UpdateRecordedPlaybackOption,
    ): Promise<apid.RecordedPlayback>;
}
