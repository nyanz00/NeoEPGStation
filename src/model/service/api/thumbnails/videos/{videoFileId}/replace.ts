import { Operation } from 'express-openapi';
import IThumbnailApiModel from '../../../../../api/thumbnail/IThumbnailApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

export const post: Operation = async (req, res) => {
    const thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');

    try {
        await thumbnailApiModel.replace(parseInt(req.params.videoFileId, 10));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'サムネイル置換',
    tags: ['thumbnails'],
    description: '指定したビデオファイルを元に録画サムネイルの再生成を開始する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: '録画サムネイルの再生成を開始しました',
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
