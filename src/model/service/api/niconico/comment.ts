import { Request } from 'express';
import { Operation } from '../../ApiOperation';
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
        await container.get<INiconicoApiModel>('INiconicoApiModel').postComment(await requireViewerProfileId(req), {
            channelId: Number(req.body?.channelId),
            text: String(req.body?.text ?? ''),
            color: String(req.body?.color ?? ''),
            position: req.body?.position,
            size: req.body?.size,
        });
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'ニコニコ公式実況へコメントを投稿',
    tags: ['niconico'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['channelId', 'text', 'color', 'position', 'size'],
                    properties: {
                        channelId: { type: 'integer' },
                        text: { type: 'string' },
                        color: { type: 'string' },
                        position: { type: 'string', enum: ['top', 'right', 'bottom'] },
                        size: { type: 'string', enum: ['big', 'medium', 'small'] },
                    },
                },
            },
        },
    },
    responses: { 204: { description: '投稿しました' }, default: { description: '予期しないエラー' } },
};
