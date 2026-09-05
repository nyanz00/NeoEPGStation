import { Operation } from '../../ApiOperation';
import IEncodeApiModel from '../../../api/encode/IEncodeApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const put: Operation = async (req, res) => {
    const encodeApiModel = container.get<IEncodeApiModel>('IEncodeApiModel');

    try {
        await encodeApiModel.reorder(req.body);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        if (err.message === 'EncodeQueueChangedError') {
            api.responseError(res, {
                code: 409,
                message: err.message,
            });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

put.apiDoc = {
    summary: '待機中エンコードの並べ替え',
    tags: ['encode'],
    description: '待機中エンコードの実行順を変更する。実行中のエンコードは変更しない。',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/EncodeQueueOrderOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: '待機中エンコードを並べ替えました',
        },
        409: {
            description: '取得後にエンコードキューが変更されました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
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
