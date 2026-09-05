import { Request } from 'express';
import { Operation } from '../../ApiOperation';
import * as apid from '../../../../../api';
import IMisskeyApiModel from '../../../api/misskey/IMisskeyApiModel';
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
            await container
                .get<IMisskeyApiModel>('IMisskeyApiModel')
                .beginAuthorization(
                    await requireViewerProfileId(req),
                    String(req.body?.visibility ?? 'home') as apid.MisskeyVisibility,
                ),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'Misskey.io MiAuth認証開始',
    tags: ['misskey'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['visibility'],
                    properties: {
                        visibility: {
                            type: 'string',
                            enum: ['public', 'home', 'followers'],
                        },
                    },
                },
            },
        },
    },
    responses: { 200: { description: '認証を開始しました' }, default: { description: '予期しないエラー' } },
};

export const patch: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IMisskeyApiModel>('IMisskeyApiModel')
                .checkAuthorization(await requireViewerProfileId(req), String(req.body?.sessionId ?? '')),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

patch.apiDoc = {
    summary: 'Misskey.io MiAuth認証確認',
    tags: ['misskey'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['sessionId'],
                    properties: {
                        sessionId: { type: 'string', format: 'uuid' },
                    },
                },
            },
        },
    },
    responses: { 200: { description: '認証状態を返します' }, default: { description: '予期しないエラー' } },
};

export const del: Operation = async (req, res) => {
    try {
        await container.get<IMisskeyApiModel>('IMisskeyApiModel').disconnect(await requireViewerProfileId(req));
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'Misskey.ioアカウント連携解除',
    tags: ['misskey'],
    responses: { 204: { description: '解除しました' }, default: { description: '予期しないエラー' } },
};
