import { Operation } from 'express-openapi';
import IAnnictApiModel from '../../../api/annict/IAnnictApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
import { getViewerProfileId } from '../viewerProfileSession';

export const put: Operation = async (req, res) => {
    try {
        const viewerProfileId = await getViewerProfileId(req);
        if (viewerProfileId === undefined) throw new Error('視聴者プロフィールを選択してください');
        await container
            .get<IAnnictApiModel>('IAnnictApiModel')
            .setWriteToken(String(req.body?.accessToken ?? ''), viewerProfileId);
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};
put.apiDoc = {
    summary: 'Annict書き込みトークン保存',
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

export const del: Operation = async (req, res) => {
    try {
        const viewerProfileId = await getViewerProfileId(req);
        if (viewerProfileId === undefined) throw new Error('視聴者プロフィールを選択してください');
        await container.get<IAnnictApiModel>('IAnnictApiModel').deleteWriteToken(viewerProfileId);
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};
del.apiDoc = {
    summary: 'Annict書き込みトークン削除',
    tags: ['annict'],
    responses: { 204: { description: '削除しました' }, default: { description: '予期しないエラー' } },
};
