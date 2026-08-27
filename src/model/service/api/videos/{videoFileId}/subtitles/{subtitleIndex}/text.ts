import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../../../api/video/IVideoApiModel';
import container from '../../../../../../ModelContainer';
import * as api from '../../../../../api';

export const get: Operation = async (req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const startAt = typeof req.query.startAt === 'string' ? Number(req.query.startAt) : undefined;
        const duration = typeof req.query.duration === 'string' ? Number(req.query.duration) : undefined;
        const result = await videoApiModel.getSubtitleText(
            parseInt(req.params.videoFileId, 10),
            parseInt(req.params.subtitleIndex, 10),
            startAt === undefined && duration === undefined
                ? undefined
                : {
                      startAt: startAt ?? 0,
                      duration: duration ?? Number.NaN,
                  },
        );
        res.status(200).json(result);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ビデオファイル内の字幕本文を取得',
    tags: ['videos'],
    description: '指定した字幕トラックをASS形式で標準出力から取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            name: 'subtitleIndex',
            in: 'path',
            required: true,
            schema: {
                type: 'integer',
            },
        },
        {
            name: 'startAt',
            in: 'query',
            required: false,
            description: '部分取得を開始する再生位置（秒）',
            schema: {
                type: 'number',
                minimum: 0,
            },
        },
        {
            name: 'duration',
            in: 'query',
            required: false,
            description: '部分取得する長さ（秒、最大3600秒）',
            schema: {
                type: 'number',
                minimum: 0,
                exclusiveMinimum: true,
                maximum: 3600,
            },
        },
    ],
    responses: {
        200: {
            description: 'ASS形式の字幕本文',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/VideoSubtitleText',
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
