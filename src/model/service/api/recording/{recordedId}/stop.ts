import { Operation } from '../../../ApiOperation.js';
import IRecordingApiModel from '../../../../api/recording/IRecordingApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

export const post: Operation = async (req, res) => {
    const recordingApiModel = container.get<IRecordingApiModel>('IRecordingApiModel');
    try {
        await recordingApiModel.stop(parseInt(req.params.recordedId, 10));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画停止',
    tags: ['recording'],
    description: '録画済みの部分を残したまま録画を停止する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedId',
        },
    ],
    responses: {
        200: {
            description: '録画を停止しました',
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
