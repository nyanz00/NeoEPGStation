import { Operation } from 'express-openapi';
import IChannelApiModel from '../../../api/channel/IChannelApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    const channelApiModel = container.get<IChannelApiModel>('IChannelApiModel');

    try {
        api.responseJSON(res, 200, await channelApiModel.getJikkyoStatuses());
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'NX-Jikkyo実況勢い一覧取得',
    tags: ['channels'],
    description: '放送局ごとの現在の実況勢いを取得する',
    responses: {
        200: {
            description: 'NX-Jikkyo実況勢い一覧',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ChannelJikkyoStatuses',
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
