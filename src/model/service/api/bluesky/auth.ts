import { Request } from 'express';
import { Operation } from '../../ApiOperation';
import IBlueskyApiModel from '../../../api/bluesky/IBlueskyApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
import { getViewerProfileId } from '../viewerProfileSession';

async function requireViewerProfileId(req: Request): Promise<number> {
    const profileId = await getViewerProfileId(req);
    if (profileId === undefined) throw new Error('視聴者プロフィールを選択してください');
    return profileId;
}

export const put: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IBlueskyApiModel>('IBlueskyApiModel')
                .connect(
                    await requireViewerProfileId(req),
                    String(req.body?.handle ?? ''),
                    String(req.body?.appPassword ?? ''),
                ),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'Blueskyアカウント連携',
    tags: ['bluesky'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['handle', 'appPassword'],
                    properties: {
                        handle: { type: 'string' },
                        appPassword: { type: 'string' },
                    },
                },
            },
        },
    },
    responses: { 200: { description: '連携しました' }, default: { description: '予期しないエラー' } },
};

export const del: Operation = async (req, res) => {
    try {
        await container.get<IBlueskyApiModel>('IBlueskyApiModel').disconnect(await requireViewerProfileId(req));
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'Blueskyアカウント連携解除',
    tags: ['bluesky'],
    responses: { 204: { description: '解除しました' }, default: { description: '予期しないエラー' } },
};
