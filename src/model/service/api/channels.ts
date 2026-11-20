import { Operation } from '../ApiOperation.js';
import IChannelApiModel from '../../api/channel/IChannelApiModel.js';
import container from '../../ModelContainer.js';
import * as api from '../api.js';

export const get: Operation = async (_req, res) => {
    const channelApiModel = container.get<IChannelApiModel>('IChannelApiModel');

    try {
        api.responseJSON(res, 200, await channelApiModel.getChannels());
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '放送局情報取得',
    tags: ['channels'],
    description: '放送局情報を取得する',
    responses: {
        200: {
            description: '放送局情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ChannelItems',
                    },
                },
            },
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
