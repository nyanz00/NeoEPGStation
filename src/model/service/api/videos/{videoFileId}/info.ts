import { Operation } from 'express-openapi';
import IVideoAnalysisModel from '../../../../video/IVideoAnalysisModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

const operation =
    (force: boolean): Operation =>
    async (req, res) => {
        const model = container.get<IVideoAnalysisModel>('IVideoAnalysisModel');
        try {
            api.responseJSON(res, 200, await model.get(parseInt(req.params.videoFileId, 10), force));
        } catch (err: any) {
            api.responseServerError(res, err.message);
        }
    };

const apiDoc = {
    summary: '動画ファイルの解析情報',
    tags: ['videos'],
    parameters: [{ $ref: '#/components/parameters/PathVideoFileId' }],
    responses: {
        200: {
            description: '解析情報を取得しました',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};

export const get: Operation = operation(false);
get.apiDoc = { ...apiDoc, description: 'キャッシュが無い、またはファイルが変更されている場合は解析して取得する' };
export const post: Operation = operation(true);
post.apiDoc = { ...apiDoc, description: '動画ファイルを再解析して取得する' };
