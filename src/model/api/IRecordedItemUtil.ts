import * as apid from '../../../api.js';
import Recorded from '../../db/entities/Recorded.js';
import { EncodeRecordedIdIndex } from '../service/encode/IEncodeManageModel.js';

export default interface IRecordedItemUtil {
    convertRecordedToRecordedItem(
        recorded: Recorded,
        isHalfWidth: boolean,
        encodeIndex?: EncodeRecordedIdIndex,
    ): apid.RecordedItem;
}
