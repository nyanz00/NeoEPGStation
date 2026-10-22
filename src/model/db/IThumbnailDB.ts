import * as apid from '../../../api.js';
import Thumbnail from '../../db/entities/Thumbnail.js';

export default interface IThumbnailDB {
    restore(items: Thumbnail[]): Promise<void>;
    insertOnce(thumbnail: Thumbnail): Promise<apid.ThumbnailId>;
    deleteOnce(thumbnailId: apid.ThumbnailId): Promise<void>;
    deleteRecordedId(recordedId: apid.RecordedId): Promise<void>;
    findId(thumbnailId: apid.ThumbnailId): Promise<Thumbnail | null>;
    findAll(): Promise<Thumbnail[]>;
}
