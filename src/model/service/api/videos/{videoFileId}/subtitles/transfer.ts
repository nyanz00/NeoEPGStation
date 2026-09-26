import { Operation } from '../../../../ApiOperation';
import IVideoApiModel from '../../../../../api/video/IVideoApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

export const post: Operation = async (req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const result = await videoApiModel.startSubtitleTransfer(parseInt(req.params.videoFileId, 10), req.body);
        res.status(202).json(result);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'MKVへ字幕トラックを移植',
    tags: ['videos'],
    description: 'developerMode専用。別のMKVから字幕トラックをコピーするタスクを開始する',
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
                    $ref: '#/components/schemas/SubtitleTransferOption',
                },
            },
        },
    },
    responses: {
        202: {
            description: '開始した字幕移植タスク',
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
