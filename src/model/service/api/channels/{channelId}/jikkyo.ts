import { Operation } from '../../../ApiOperation';
import INiconicoApiModel from '../../../../api/niconico/INiconicoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
import { getViewerProfileId } from '../../viewerProfileSession';

export const get: Operation = async (req, res) => {
    const niconicoApiModel = container.get<INiconicoApiModel>('INiconicoApiModel');

    try {
        let viewerProfileId: number | undefined;
        try {
            viewerProfileId = await getViewerProfileId(req);
        } catch {
            viewerProfileId = undefined;
        }
        const result = await niconicoApiModel.getJikkyoInfo(parseInt(req.params.channelId, 10), viewerProfileId);
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
