import * as apid from '../../../api.js';
import RecordedHistory from '../../db/entities/RecordedHistory.js';

export default interface IRecordedHistoryDB {
    restore(items: RecordedHistory[]): Promise<void>;
    insertOnce(program: RecordedHistory): Promise<apid.RecordedHistoryId>;
    delete(time: apid.UnixtimeMS): Promise<void>;
    findAll(): Promise<RecordedHistory[]>;
}
