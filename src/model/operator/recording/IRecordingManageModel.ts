import * as apid from '../../../../api.js';
import * as mapid from '../../tuner/TunerApi.js';
import { IReserveUpdateValues } from '../../event/IReserveEvent.js';
import { RecordingDropLogFile } from './IRecorderModel.js';

export default interface IRecordingManageModel {
    setTuner(tuners: mapid.TunerDevice[]): void;
    cleanup(): Promise<void>;
    update(diff: IReserveUpdateValues): Promise<void>;
    hasReserve(reserveId: apid.ReserveId): boolean;
    cancel(reserveId: apid.ReserveId, isPlanToDelete: boolean): Promise<void>;
    getCurrentDropLogFiles(): RecordingDropLogFile[];
    resetTimer(): void;
}
