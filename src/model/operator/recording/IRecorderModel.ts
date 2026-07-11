import * as apid from '../../../../api';
import Reserve from '../../../db/entities/Reserve';

export type RecorderModelProvider = () => Promise<IRecorderModel>;

export interface RecordingDropLogFile {
    recordedId: apid.RecordedId;
    dropLogFile: apid.DropLogFile;
}

export default interface IRecorderModel {
    setTimer(reserve: Reserve, isSuppressLog: boolean): boolean;
    cancel(isPlanToDelete: boolean): Promise<void>;
    update(newReserve: Reserve, isSuppressLog: boolean): Promise<void>;
    getCurrentDropLogFile(): RecordingDropLogFile | null;
    resetTimer(): boolean;
}
