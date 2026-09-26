import { Operation } from '../../ApiOperation';
import IRecordingApiModel from '../../../api/recording/IRecordingApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    const recordingApiModel = container.get<IRecordingApiModel>('IRecordingApiModel');
    try {
        api.responseJSON(res, 200, await recordingApiModel.getDropStatus());
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画中のドロップ数取得',
    tags: ['recording'],
    description: '録画中の録画IDとドロップ・エラー・スクランブル数を取得する',
    responses: {
        200: {
            description: '録画中のドロップ数を取得しました',
            content: {
                'application/json': {
                    schema: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['recordedId', 'dropLogFile'],
                            properties: {
                                recordedId: { $ref: '#/components/schemas/RecordedId' },
                                dropLogFile: {
                                    $ref: '#/components/schemas/DropLogFile',
                                },
                            },
                        },
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
