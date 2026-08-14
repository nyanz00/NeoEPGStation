import { Operation } from 'express-openapi';
import IJikkyoApiModel from '../../../../api/jikkyo/IJikkyoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const jikkyoApiModel = container.get<IJikkyoApiModel>('IJikkyoApiModel');

    try {
        const videoFileId = parseInt(String(req.query.videoFileId), 10);
        if (Number.isInteger(videoFileId) === false) {
            api.responseError(res, { code: 400, message: 'videoFileId is required.' });
            return;
        }
        const result = await jikkyoApiModel.getRecordedComments(parseInt(req.params.recordedId, 10), videoFileId);
        api.responseJSON(res, 200, result);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画番組のNX-Jikkyo過去ログを取得',
    tags: ['recorded'],
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedId',
        },
        {
            in: 'query',
            name: 'videoFileId',
            required: true,
            schema: {
                type: 'integer',
            },
            description: '実況時刻の解析対象にするTSビデオファイルID',
        },
    ],
    responses: {
        200: {
            description: 'NX-Jikkyo過去ログコメント',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RecordedJikkyoComments',
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
