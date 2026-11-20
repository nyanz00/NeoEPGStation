import { Operation } from '../../../ApiOperation.js';
import IAnnictApiModel from '../../../../api/annict/IAnnictApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IAnnictApiModel>('IAnnictApiModel')
                .getWork(parseInt(req.params.annictId, 10), String(req.query.refresh) === 'true'),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};
get.apiDoc = {
    summary: 'Annict作品詳細取得',
    tags: ['annict'],
    parameters: [
        { name: 'annictId', in: 'path', required: true, schema: { type: 'integer' } },
        { name: 'refresh', in: 'query', schema: { type: 'boolean' } },
    ],
    responses: { 200: { description: '取得しました' }, default: { description: '予期しないエラー' } },
};
