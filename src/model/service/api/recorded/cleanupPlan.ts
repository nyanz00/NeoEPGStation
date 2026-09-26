import { Operation } from '../../ApiOperation';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const plan = await recordedApiModel.getLatestCleanupPlan();
        if (plan === null) {
            res.status(204).end();
            return;
        }
        api.responseJSON(res, 200, plan);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '最新の録画クリーンアップ計画を取得',
    tags: ['recorded'],
    description: '現在も存在する最新の候補リストと、ファイル内容から再集計した件数を取得する',
    responses: {
        200: {
            description: '候補リストと現在の集計結果を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RecordedCleanupPlanResult',
                    },
                },
            },
        },
        204: {
            description: '候補リストが存在しません',
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
