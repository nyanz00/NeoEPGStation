import { Operation } from '../../ApiOperation.js';
import IAnnictApiModel from '../../../api/annict/IAnnictApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';
import { getViewerProfileId } from '../viewerProfileSession.js';

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container.get<IAnnictApiModel>('IAnnictApiModel').getStatus(await getViewerProfileId(req, false)),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'Annict連携状態取得',
    tags: ['annict'],
    responses: { 200: { description: '取得しました' }, default: { description: '予期しないエラー' } },
};
