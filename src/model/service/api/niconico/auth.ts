import { Request } from 'express';
import { Operation } from 'express-openapi';
import INiconicoApiModel from '../../../api/niconico/INiconicoApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
import { getViewerProfileId } from '../viewerProfileSession';

async function requireViewerProfileId(req: Request): Promise<number> {
    const profileId = await getViewerProfileId(req);
    if (profileId === undefined) throw new Error('視聴者プロフィールを選択してください');
    return profileId;
}

export const post: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container.get<INiconicoApiModel>('INiconicoApiModel').login(await requireViewerProfileId(req), {
                cookiesText: String(req.body?.cookiesText ?? ''),
            }),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'ニコニコアカウントのCookieを連携',
    tags: ['niconico'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['cookiesText'],
                    properties: {
                        cookiesText: { type: 'string' },
                    },
                },
            },
        },
    },
    responses: { 200: { description: 'ログイン結果' }, default: { description: '予期しないエラー' } },
};

export const del: Operation = async (req, res) => {
    try {
        await container.get<INiconicoApiModel>('INiconicoApiModel').disconnect(await requireViewerProfileId(req));
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'ニコニコアカウント連携解除',
    tags: ['niconico'],
    responses: { 204: { description: '解除しました' }, default: { description: '予期しないエラー' } },
};
