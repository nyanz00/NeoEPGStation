import { Operation } from '../../ApiOperation';
import IBlueskyApiModel from '../../../api/bluesky/IBlueskyApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
import { getViewerProfileId } from '../viewerProfileSession';

export const get: Operation = async (req, res) => {
    try {
        const profileId = await getViewerProfileId(req);
        if (profileId === undefined) throw new Error('視聴者プロフィールを選択してください');
        api.responseJSON(
            res,
            200,
            await container
                .get<IBlueskyApiModel>('IBlueskyApiModel')
                .search(profileId, typeof req.query.query === 'string' ? req.query.query : ''),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'Blueskyポスト検索',
    tags: ['bluesky'],
    parameters: [
        {
            in: 'query',
            name: 'query',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 500 },
        },
    ],
    responses: { 200: { description: '取得しました' }, default: { description: '予期しないエラー' } },
};
