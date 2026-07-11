import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IVideoApiModel from './IVideoApiModel';

@injectable()
export default class VideoApiModel implements IVideoApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * ビデオファイルの削除
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async delete(videoFileId: apid.VideoFileId): Promise<void> {
        await this.repository.delete(`/videos/${videoFileId}`);
    }

    /**
     * 指定したビデオファイルの長さを取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<number> 動画の長さ(秒)
     */
    public async getDuration(videoFileId: apid.VideoFileId): Promise<number> {
        const result = await this.repository.get(`/videos/${videoFileId}/duration`);

        return result.data.duration;
    }

    public async getSubtitles(videoFileId: apid.VideoFileId): Promise<apid.VideoSubtitles> {
        const result = await this.repository.get(`/videos/${videoFileId}/subtitles`);

        return result.data;
    }

    public async getSubtitleText(videoFileId: apid.VideoFileId, subtitleIndex: number): Promise<apid.VideoSubtitleText> {
        const result = await this.repository.get(`/videos/${videoFileId}/subtitles/${subtitleIndex}/text`);

        return result.data;
    }

    public async prepareSubtitle(videoFileId: apid.VideoFileId, subtitleIndex: number): Promise<apid.VideoPreparedSubtitle> {
        const result = await this.repository.post(`/videos/${videoFileId}/subtitles/${subtitleIndex}/prepare`, {});

        return result.data;
    }

    /**
     * kodi にビデオリンクを送信する
     * @param hostName: kodi host name
     * @param videoFileId: apid.VideoFileId)
     * @return Promise<void>
     */
    public async sendToKodi(hostName: string, videoFileId: apid.VideoFileId): Promise<void> {
        await this.repository.post(`/videos/${videoFileId}/kodi`, {
            kodiName: hostName,
        });
    }

    /**
     * ビデオファイルををアップロードする
     * @param option: apid.UploadVideoFileOption
     * @return Promise<void>
     */
    public async uploadedVideoFile(option: apid.UploadVideoFileOption): Promise<void> {
        const formData = new FormData();
        formData.append('recordedId', option.recordedId.toString(10));
        formData.append('parentDirectoryName', option.parentDirectoryName);
        if (typeof option.subDirectory !== 'undefined') {
            formData.append('subDirectory', option.subDirectory);
        }
        formData.append('viewName', option.viewName);
        formData.append('fileType', option.fileType);
        formData.append('file', option.file);

        await this.repository.post('/videos/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
    }
}
