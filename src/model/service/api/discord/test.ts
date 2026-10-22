import { Operation } from '../../ApiOperation.js';
import IDiscordNotificationModel from '../../../operator/discord/IDiscordNotificationModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

export const post: Operation = async (req, res) => {
    try {
        await container
            .get<IDiscordNotificationModel>('IDiscordNotificationModel')
            .testDestination(String(req.body?.destinationId ?? ''));
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'Discordテスト通知送信',
    tags: ['discord'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    required: ['destinationId'],
                    properties: { destinationId: { type: 'string' } },
                },
            },
        },
    },
    responses: { 204: { description: '送信しました' }, default: { description: '予期しないエラー' } },
};
