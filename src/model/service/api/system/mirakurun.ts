import { Operation } from 'express-openapi';
import IMirakurunStatusApiModel from '../../../api/system/IMirakurunStatusApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    const mirakurunStatusApiModel = container.get<IMirakurunStatusApiModel>('IMirakurunStatusApiModel');
    try {
        api.responseJSON(res, 200, await mirakurunStatusApiModel.getStatus());
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'Mirakurun状態取得',
    tags: ['system'],
    description: 'Mirakurunへの接続状態とチューナー使用状況を取得する',
    responses: {
        200: {
            description: 'Mirakurun状態を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/SystemMirakurunInfo',
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
