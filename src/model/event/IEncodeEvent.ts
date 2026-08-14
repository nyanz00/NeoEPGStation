import * as apid from '../../../api';

export interface FinishEncodeInfo {
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId;
    parentDirName: string;
    filePath: string | null;
    fullOutputPath: string | null;
    mode: string;
    removeOriginal: boolean;
    updateThumbnail: boolean;
}

export interface ErrorEncodeInfo {
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId;
    mode: string;
    encoderMessage?: string;
}

export default interface IEncodeEvent {
    emitAddEncode(encodeId: apid.EncodeId): void;
    emitCancelEncode(encodeId: apid.EncodeId): void;
    emitFinishEncode(info: FinishEncodeInfo): void;
    emitErrorEncode(info: ErrorEncodeInfo): void;
    emitUpdateEncodeProgress(): void;
    setAddEncode(callback: (encodeId: apid.EncodeId) => void): void;
    setCancelEncode(callback: (encodeId: apid.EncodeId) => void): void;
    setFinishEncode(callback: (info: FinishEncodeInfo) => void): void;
    setErrorEncode(callback: (info: ErrorEncodeInfo) => void): void;
    setUpdateEncodeProgress(callback: () => void): void;
}
