import * as apid from '../../../../api';
import * as mapid from '../../../../node_modules/mirakurun/api';
import { IReserveUpdateValues } from '../../event/IReserveEvent';
import { RecordingDropLogFile } from './IRecorderModel';

export default interface IRecordingManageModel {
    setTuner(tuners: mapid.TunerDevice[]): void;
    cleanup(): Promise<void>;
    update(diff: IReserveUpdateValues): Promise<void>;
    hasReserve(reserveId: apid.ReserveId): boolean;
    cancel(reserveId: apid.ReserveId, isPlanToDelete: boolean): Promise<void>;
    getCurrentDropLogFiles(): RecordingDropLogFile[];
    resetTimer(): void;
}
