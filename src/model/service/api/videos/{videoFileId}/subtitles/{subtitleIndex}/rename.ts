import { Operation } from '../../../../../ApiOperation';
import IVideoApiModel from '../../../../../../api/video/IVideoApiModel';
import container from '../../../../../../ModelContainer';
import * as api from '../../../../../api';

export const post: Operation = async (req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const result = await videoApiModel.startSubtitleRename(
            parseInt(req.params.videoFileId, 10),
            parseInt(req.params.subtitleIndex, 10),
            req.body,
        );
        res.status(202).json(result);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'MKV字幕トラック名を変更',
    tags: ['videos'],
    description: 'developerMode専用。MKV内の既存字幕トラック名を変更するタスクを開始する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            name: 'subtitleIndex',
            in: 'path',
            required: true,
            schema: {
                type: 'integer',
                minimum: 0,
            },
        },
    ],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/SubtitleRenameOption',
                },
            },
        },
    },
    responses: {
        202: {
            description: '開始した字幕名変更タスク',
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
