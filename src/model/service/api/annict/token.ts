import { Operation } from 'express-openapi';
import IAnnictApiModel from '../../../api/annict/IAnnictApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const put: Operation = async (req, res) => {
    try {
        await container.get<IAnnictApiModel>('IAnnictApiModel').setToken(String(req.body?.accessToken ?? ''));
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};
put.apiDoc = {
    summary: 'Annictトークン保存',
    tags: ['annict'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: { type: 'object', required: ['accessToken'], properties: { accessToken: { type: 'string' } } },
            },
        },
    },
    responses: { 204: { description: '保存しました' }, default: { description: '予期しないエラー' } },
};

export const del: Operation = async (_req, res) => {
    try {
        await container.get<IAnnictApiModel>('IAnnictApiModel').deleteToken();
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};
del.apiDoc = {
    summary: 'Annictトークン削除',
    tags: ['annict'],
    responses: { 204: { description: '削除しました' }, default: { description: '予期しないエラー' } },
};
