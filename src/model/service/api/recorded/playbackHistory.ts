import { Operation } from '../../ApiOperation.js';
import IRecordedPlaybackApiModel from '../../../api/recorded/IRecordedPlaybackApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';
import { getActiveUserId } from '../activeUser.js';

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IRecordedPlaybackApiModel>('IRecordedPlaybackApiModel')
                .getHistory(getActiveUserId(req), req.query.isHalfWidth === 'true'),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'アクティブユーザーの録画視聴履歴を取得',
    tags: ['recorded'],
    parameters: [{ in: 'query', name: 'isHalfWidth', schema: { type: 'boolean', default: false } }],
    responses: {
        200: {
            description: '取得しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordedPlaybackHistory' } } },
        },
        default: { description: '予期しないエラー' },
    },
};
