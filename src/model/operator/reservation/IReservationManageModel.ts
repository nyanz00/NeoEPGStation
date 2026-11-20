import * as apid from '../../../../api.js';
import * as mapid from '../../tuner/TunerApi.js';
import Reserve from '../../../db/entities/Reserve.js';

export default interface IReservationManageModel {
    setTuners(tuners: mapid.TunerDevice[]): void;
    getBroadcastStatus(): apid.BroadcastStatus;
    add(option: apid.ManualReserveOption): Promise<apid.ReserveId>;
    addEventRelay(programId: apid.ProgramId, parentReserve: Reserve): Promise<apid.ReserveId | null>;
    update(reserveId: apid.ReserveId, isSuppressLog?: boolean): Promise<void>;
    updateRule(
        ruleId: apid.RuleId,
        isSuppressLog?: boolean,
        isFirstUpdate?: boolean,
        preserveActiveRecordings?: boolean,
    ): Promise<void>;
    updateAll(isFirstUpdate?: boolean): Promise<void>;
    cancel(reserveId: apid.ReserveId, ignoreNotFound?: boolean): Promise<void>;
    removeSkip(reserveId: apid.ReserveId): Promise<void>;
    removeOverlap(reserveId: apid.ReserveId): Promise<void>;
    edit(reserveId: apid.ReserveId, option: apid.EditManualReserveOption): Promise<void>;
    cleanup(): Promise<void>;
}
