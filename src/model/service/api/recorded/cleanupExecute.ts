import { Operation } from '../../ApiOperation.js';
import * as apid from '../../../../../api.js';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

export const post: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    try {
        const option = req.body as apid.RecordedCleanupExecuteOption;
        api.responseJSON(res, 200, await recordedApiModel.executeCleanupPlan(option.planPath));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画クリーンアップ計画を実行',
    tags: ['recorded'],
    description: '計画ファイルに残っている削除対象のみ削除する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/RecordedCleanupExecuteOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: '録画クリーンアップ計画を実行しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RecordedCleanupExecuteResult',
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
