import { Operation } from '../../ApiOperation.js';
import IReserveApiModel from '../../../api/reserve/IReserveApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

export const post: Operation = async (_req, res) => {
    const reserveApiModel = container.get<IReserveApiModel>('IReserveApiModel');

    try {
        await reserveApiModel.updateAll();
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '予約情報の更新開始',
    tags: ['reserves'],
    description: '予約情報の更新を開始する',
    responses: {
        200: {
            description: '予約情報の更新を開始しました',
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
