import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IThumbnailApiModel from './IThumbnailApiModel';

@injectable()
export default class ThumbnailApiModel implements IThumbnailApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * サムネイルのクリーンアップ
     * @return Promise<void>
     */
    public async cleanup(): Promise<void> {
        await this.repository.post('/thumbnails/cleanup');
    }

    /**
     * 指定したビデオファイルから録画サムネイルを再生成
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async replace(videoFileId: apid.VideoFileId): Promise<void> {
        await this.repository.post(`/thumbnails/videos/${videoFileId}/replace`);
    }
}
