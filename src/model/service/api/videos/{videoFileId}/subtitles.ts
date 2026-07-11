import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const result = await videoApiModel.getSubtitles(parseInt(req.params.videoFileId, 10));
        res.status(200).json(result);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ビデオファイル内の字幕トラック一覧',
    tags: ['videos'],
    description: '指定したビデオファイルに含まれる字幕トラック一覧を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: '字幕トラック一覧',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/VideoSubtitles',
                    },
                },
            },
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
