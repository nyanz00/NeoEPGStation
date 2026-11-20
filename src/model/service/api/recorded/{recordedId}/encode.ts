import { Operation } from '../../../ApiOperation.js';
import IRecordedApiModel from '../../../../api/recorded/IRecordedApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

export const del: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        await recordedApiModel.stopEncode(parseInt(req.params.recordedId, 10));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'エンコード停止',
    tags: ['recorded'],
    description: 'エンコードを停止する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedId',
        },
    ],
    responses: {
        200: {
            description: 'エンコードを停止しました',
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
