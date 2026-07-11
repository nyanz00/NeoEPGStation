import { Operation } from 'express-openapi';
import IChannelApiModel from '../../../../api/channel/IChannelApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const channelApiModel = container.get<IChannelApiModel>('IChannelApiModel');

    try {
        const result = await channelApiModel.getJikkyoInfo(parseInt(req.params.channelId, 10));
        res.status(200).json(result);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'NX-Jikkyo実況接続情報取得',
    tags: ['channels'],
    parameters: [
        {
            $ref: '#/components/parameters/PathChannelId',
        },
    ],
    responses: {
        200: {
            description: 'NX-Jikkyo実況接続情報',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ChannelJikkyoInfo',
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
