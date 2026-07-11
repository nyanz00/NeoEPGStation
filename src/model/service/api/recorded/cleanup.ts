import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const post: Operation = async (_req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const result = await recordedApiModel.createCleanupPlan();
        api.responseJSON(res, 200, result);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画クリーンアップ候補を作成',
    tags: ['recorded'],
    description: '録画クリーンアップ候補リストを作成する',
    responses: {
        200: {
            description: '録画クリーンアップ候補リストを作成しました',
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
