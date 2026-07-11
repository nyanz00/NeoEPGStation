import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (_req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        api.responseJSON(res, 200, await recordedApiModel.createCleanupPlan());
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画クリーンアップ計画を作成',
    tags: ['recorded'],
    description: '削除候補をファイルに書き出す',
    responses: {
        200: {
            description: '録画クリーンアップ計画を作成しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RecordedCleanupPlanResult',
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
