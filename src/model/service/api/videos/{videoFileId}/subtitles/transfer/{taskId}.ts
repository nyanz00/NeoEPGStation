import { Operation } from '../../../../../ApiOperation';
import IVideoApiModel from '../../../../../../api/video/IVideoApiModel';
import container from '../../../../../../ModelContainer';
import * as api from '../../../../../api';

export const get: Operation = async (req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const result = await videoApiModel.getSubtitleTransferTask(
            parseInt(req.params.videoFileId, 10),
            req.params.taskId,
        );
        res.status(200).json(result);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'MKV字幕移植タスクを取得',
    tags: ['videos'],
    description: 'developerMode専用。字幕移植タスクの状態を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            name: 'taskId',
            in: 'path',
            required: true,
            schema: {
                type: 'string',
            },
        },
    ],
    responses: {
        200: {
            description: '字幕移植タスク',
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
