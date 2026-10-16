import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import { parseAssComments } from '../../../util/AssCommentParser';
import IVideoFileDB from '../../db/IVideoFileDB';
import IJikkyoApiModel from '../jikkyo/IJikkyoApiModel';
import IVideoApiModel from './IVideoApiModel';
import IVideoCommentApiModel from './IVideoCommentApiModel';

export class VideoCommentRequestError extends Error {
    constructor(
        public readonly code: 400 | 404,
        message: string,
    ) {
        super(message);
    }
}

@injectable()
export default class VideoCommentApiModel implements IVideoCommentApiModel {
    constructor(
        @inject('IVideoFileDB') private readonly videoFileDB: IVideoFileDB,
        @inject('IVideoApiModel') private readonly videoApi: IVideoApiModel,
        @inject('IJikkyoApiModel') private readonly jikkyoApi: IJikkyoApiModel,
    ) {}

    public async getComments(videoFileId: apid.VideoFileId, subtitleIndex?: number): Promise<apid.VideoComments> {
        if (!Number.isSafeInteger(videoFileId) || videoFileId < 0) {
            throw new VideoCommentRequestError(400, 'VideoFileIdIsInvalid');
        }
        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (videoFile === null) throw new VideoCommentRequestError(404, 'VideoFileIsUndefined');
        if (videoFile.type === 'ts') {
            if (subtitleIndex !== undefined) {
                throw new VideoCommentRequestError(400, 'TS comments use jikkyo; subtitleIndex must be omitted.');
            }
            return {
                ...(await this.jikkyoApi.getRecordedComments(videoFile.recordedId, videoFileId)),
                source: 'jikkyo',
                timeBase: 'video',
            };
        }
        if (videoFile.type !== 'encoded') throw new VideoCommentRequestError(400, 'UnsupportedVideoFileType');
        if (subtitleIndex === undefined || !Number.isSafeInteger(subtitleIndex) || subtitleIndex < 0) {
            throw new VideoCommentRequestError(400, 'An encoded video requires a non-negative subtitleIndex.');
        }
        const subtitles = await this.videoApi.getSubtitles(videoFileId);
        if (!subtitles.items.some(item => item.subtitleIndex === subtitleIndex)) {
            throw new VideoCommentRequestError(400, 'SubtitleTrackIsUndefined');
        }
        const { subtitleText } = await this.videoApi.getSubtitleText(videoFileId, subtitleIndex);
        const comments = parseAssComments(subtitleText);
        return {
            isSuccess: comments.length > 0,
            comments,
            detail: comments.length > 0 ? '字幕からコメントを取得しました。' : 'この字幕にコメントは存在しません。',
            source: 'ass',
            timeBase: 'video',
            subtitleIndex,
        };
    }
}
