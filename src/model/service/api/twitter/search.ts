import { Operation } from 'express-openapi';
import ITwitterApiModel from '../../../api/twitter/ITwitterApiModel';
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
                .get<ITwitterApiModel>('ITwitterApiModel')
                .search(profileId, typeof req.query.query === 'string' ? req.query.query : ''),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'Twitterポスト検索',
    tags: ['twitter'],
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
