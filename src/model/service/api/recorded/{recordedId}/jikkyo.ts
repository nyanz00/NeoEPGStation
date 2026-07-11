import { Operation } from 'express-openapi';
import IJikkyoApiModel from '../../../../api/jikkyo/IJikkyoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const jikkyoApiModel = container.get<IJikkyoApiModel>('IJikkyoApiModel');

    try {
        const result = await jikkyoApiModel.getRecordedComments(parseInt(req.params.recordedId, 10));
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
