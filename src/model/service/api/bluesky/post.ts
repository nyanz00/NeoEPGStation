import { Operation } from 'express-openapi';
import IBlueskyApiModel from '../../../api/bluesky/IBlueskyApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
import { getViewerProfileId } from '../viewerProfileSession';

export const post: Operation = async (req, res) => {
    try {
        const profileId = await getViewerProfileId(req);
        if (profileId === undefined) throw new Error('視聴者プロフィールを選択してください');
        await container.get<IBlueskyApiModel>('IBlueskyApiModel').post(profileId, String(req.body?.text ?? ''));
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'Blueskyへポスト',
    tags: ['bluesky'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['text'],
                    properties: { text: { type: 'string', minLength: 1, maxLength: 300 } },
                },
            },
        },
    },
    responses: { 204: { description: '投稿しました' }, default: { description: '予期しないエラー' } },
};
