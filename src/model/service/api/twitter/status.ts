import { Operation } from '../../ApiOperation.js';
import ITwitterApiModel from '../../../api/twitter/ITwitterApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';
import { getViewerProfileId } from '../viewerProfileSession.js';

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container.get<ITwitterApiModel>('ITwitterApiModel').getStatus(await getViewerProfileId(req, false)),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'Twitter連携状態取得',
    tags: ['twitter'],
    responses: { 200: { description: '取得しました' }, default: { description: '予期しないエラー' } },
};
