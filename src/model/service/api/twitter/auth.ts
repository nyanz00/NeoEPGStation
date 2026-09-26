import { Request } from 'express';
import { Operation } from '../../ApiOperation';
import ITwitterApiModel from '../../../api/twitter/ITwitterApiModel';
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
                .get<ITwitterApiModel>('ITwitterApiModel')
                .connect(
                    await requireViewerProfileId(req),
                    String(req.body?.cookiesText ?? ''),
                    typeof req.body?.userAgent === 'string' ? req.body.userAgent : undefined,
                ),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'Twitterアカウント連携',
    tags: ['twitter'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['cookiesText'],
                    properties: {
                        cookiesText: { type: 'string' },
                        userAgent: { type: 'string' },
                    },
                },
            },
        },
    },
    responses: { 200: { description: '連携しました' }, default: { description: '予期しないエラー' } },
};

export const del: Operation = async (req, res) => {
    try {
        await container.get<ITwitterApiModel>('ITwitterApiModel').disconnect(await requireViewerProfileId(req));
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'Twitterアカウント連携解除',
    tags: ['twitter'],
    responses: { 204: { description: '解除しました' }, default: { description: '予期しないエラー' } },
};
