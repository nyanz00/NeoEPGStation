import { Operation } from '../../ApiOperation.js';
import INiconicoApiModel from '../../../api/niconico/INiconicoApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';
import { getViewerProfileId } from '../viewerProfileSession.js';

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container.get<INiconicoApiModel>('INiconicoApiModel').getStatus(await getViewerProfileId(req, false)),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ニコニコアカウント連携状態取得',
    tags: ['niconico'],
    responses: { 200: { description: '連携状態' }, default: { description: '予期しないエラー' } },
};
