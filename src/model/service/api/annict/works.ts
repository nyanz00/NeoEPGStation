import { Operation } from 'express-openapi';
import IAnnictApiModel from '../../../api/annict/IAnnictApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IAnnictApiModel>('IAnnictApiModel')
                .getWorks(
                    String(req.query.season ?? ''),
                    String(req.query.refresh) === 'true',
                    String(req.query.rerun) === 'true',
                ),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};
get.apiDoc = {
    summary: 'Annict作品一覧取得',
    tags: ['annict'],
    parameters: [
        { name: 'season', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'refresh', in: 'query', schema: { type: 'boolean' } },
        { name: 'rerun', in: 'query', schema: { type: 'boolean' } },
    ],
    responses: { 200: { description: '取得しました' }, default: { description: '予期しないエラー' } },
};
