import * as http from 'http';
import * as mapid from '../../tuner/TunerApi.js';
import Reserve from '../../../db/entities/Reserve.js';

interface IRecordingStreamCreator {
    setTuner(tuners: mapid.TunerDevice[]): void;
    create(reserve: Reserve, abortSignal: AbortSignal): Promise<http.IncomingMessage>;
    changeEndAt(reserve: Reserve): void;
}

namespace IRecordingStreamCreator {
    export const PREP_TIME = 15 * 1000;
}

export default IRecordingStreamCreator;
