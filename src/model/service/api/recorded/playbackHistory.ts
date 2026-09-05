import { Operation } from '../../ApiOperation';
import IRecordedPlaybackApiModel from '../../../api/recorded/IRecordedPlaybackApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
import { getActiveUserId } from '../activeUser';

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IRecordedPlaybackApiModel>('IRecordedPlaybackApiModel')
                .getHistory(getActiveUserId(req), req.query.isHalfWidth === 'true', Number(req.query.limit ?? 50)),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'アクティブユーザーの録画視聴履歴を取得',
    tags: ['recorded'],
    parameters: [
        { in: 'query', name: 'isHalfWidth', schema: { type: 'boolean', default: false } },
        { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
    ],
    responses: {
        200: {
            description: '取得しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordedPlaybackHistory' } } },
        },
        default: { description: '予期しないエラー' },
    },
};
