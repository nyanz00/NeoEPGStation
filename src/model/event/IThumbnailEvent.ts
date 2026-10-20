import * as apid from '../../../api';

export default interface IThumbnailEvent {
    emitAdded(videoFileId: apid.VideoFileId, recordedId: apid.RecordedId): void;
    emitDeleted(recordedId: apid.RecordedId): void;
    setAdded(callback: (videoFileId: apid.VideoFileId, recordedId: apid.RecordedId) => void): void;
    setDeleted(callback: (recordedId: apid.RecordedId) => void): void;
}
