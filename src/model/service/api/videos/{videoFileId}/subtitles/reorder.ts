import { Operation } from '../../../../ApiOperation.js';
import IVideoApiModel from '../../../../../api/video/IVideoApiModel.js';
import container from '../../../../../ModelContainer.js';
import * as api from '../../../../api.js';

export const post: Operation = async (req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const result = await videoApiModel.startSubtitleReorder(parseInt(req.params.videoFileId, 10), req.body);
        res.status(202).json(result);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'MKV字幕トラックを並び替え',
    tags: ['videos'],
    description: 'developerMode専用。MKV内の字幕トラックを指定した順序へ並び替えるタスクを開始する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/SubtitleReorderOption',
                },
            },
        },
    },
    responses: {
        202: {
            description: '開始した字幕並び替えタスク',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/SubtitleTransferTask',
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
