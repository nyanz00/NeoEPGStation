import { Operation } from '../../ApiOperation.js';
import IRecordingApiModel from '../../../api/recording/IRecordingApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

export const post: Operation = async (_req, res) => {
    const recordingApiModel = container.get<IRecordingApiModel>('IRecordingApiModel');
    try {
        await recordingApiModel.resetTimer();
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '予約タイマー再設定',
    tags: ['recording'],
    description: '予約タイマーを再設定する',
    responses: {
        200: {
            description: '予約タイマーを再設定しました',
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
