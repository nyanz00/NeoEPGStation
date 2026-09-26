import { Operation } from '../../../ApiOperation';
import IEncodeApiModel from '../../../../api/encode/IEncodeApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    const encodeApiModel = container.get<IEncodeApiModel>('IEncodeApiModel');

    try {
        await encodeApiModel.retry(parseInt(req.params.encodeId, 10));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'エンコードを再開',
    tags: ['encode'],
    description: '要確認キューのエンコードを安全性を確認して再開する',
    parameters: [
        {
            $ref: '#/components/parameters/PathEncodeId',
        },
    ],
    responses: {
        200: {
            description: 'エンコードを再開しました',
        },
        default: {
            description: '再開できない、または予期しないエラー',
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
