import { Operation } from '../../ApiOperation';
import INiconicoApiModel from '../../../api/niconico/INiconicoApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
import { getViewerProfileId } from '../viewerProfileSession';

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
