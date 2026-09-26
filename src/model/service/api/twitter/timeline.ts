import { Operation } from '../../ApiOperation';
import ITwitterApiModel from '../../../api/twitter/ITwitterApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
import { getViewerProfileId } from '../viewerProfileSession';

export const get: Operation = async (req, res) => {
    try {
        const profileId = await getViewerProfileId(req);
        if (profileId === undefined) throw new Error('視聴者プロフィールを選択してください');
        api.responseJSON(res, 200, await container.get<ITwitterApiModel>('ITwitterApiModel').getTimeline(profileId));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'Twitterホームタイムライン取得',
    tags: ['twitter'],
    responses: { 200: { description: '取得しました' }, default: { description: '予期しないエラー' } },
};
