import * as apid from '../../../../../api.js';
import ProcessUtil from '../../../../util/ProcessUtil.js';
import IStreamBaseModel from './IStreamBaseModel.js';

export type RecordedStreamModelProvider = () => Promise<IRecordedStreamBaseModel>;
export type RecordedHLSStreamModelProvider = () => Promise<IRecordedStreamBaseModel>;

export interface RecordedStreamOption {
    videoFileId: apid.VideoFileId;
    playPosition: number; // 再生位置(秒)
    cmd: string;
    preprocessor?: ProcessUtil.Cmds;
}

export interface VideoFileInfo {
    duration: number;
    size: number;
    bitRate: number;
}

export default interface IRecordedStreamBaseModel extends IStreamBaseModel<RecordedStreamOption> {
    setOption(option: RecordedStreamOption, mode: number): void;
}
