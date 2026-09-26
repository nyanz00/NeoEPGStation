import { Operation } from '../../ApiOperation';
import * as apid from '../../../../../api';
import IDiscordNotificationModel from '../../../operator/discord/IDiscordNotificationModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container.get<IDiscordNotificationModel>('IDiscordNotificationModel').getSettings(),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'Discord通知設定取得',
    tags: ['discord'],
    responses: {
        200: {
            description: '取得しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DiscordNotificationSettings' } } },
        },
        default: { description: '予期しないエラー' },
    },
};

export const put: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IDiscordNotificationModel>('IDiscordNotificationModel')
                .updateSettings(req.body as apid.UpdateDiscordNotificationSettings),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'Discord通知設定更新',
    tags: ['discord'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/UpdateDiscordNotificationSettings' },
            },
        },
    },
    responses: {
        200: {
            description: '更新しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DiscordNotificationSettings' } } },
        },
        default: { description: '予期しないエラー' },
    },
};
