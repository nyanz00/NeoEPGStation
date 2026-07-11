import * as apid from '../../../api';

/**
 * 追加されたビデオファイル情報
 */
export interface OperatorFinishEncodeInfo {
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId | null;
    mode: string; // エンコードモード名
}

export interface OperatorErrorEncodeInfo {
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId;
    mode: string;
}

export default interface IOperatorEncodeEvent {
    emitFinishEncode(info: OperatorFinishEncodeInfo): void;
    emitErrorEncode(info: OperatorErrorEncodeInfo): void;
    setFinishEncode(callback: (info: OperatorFinishEncodeInfo) => void): void;
    setErrorEncode(callback: (info: OperatorErrorEncodeInfo) => void): void;
}
