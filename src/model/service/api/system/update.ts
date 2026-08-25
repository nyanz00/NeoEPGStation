import { Operation } from 'express-openapi';
import UpdateManager from '../../../update/UpdateManager';
import { isStartSystemUpdateOption } from '../../../update/UpdateValidation';
import * as api from '../../api';

const manager = UpdateManager.getInstance();

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(res, 200, await manager.getInfo(req.query.refresh === 'true'));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

export const post: Operation = async (req, res) => {
    const option: unknown = req.body ?? {};
    if (!isStartSystemUpdateOption(option)) {
        api.responseError(res, { code: 400, message: 'invalid update option' });
        return;
    }
    try {
        api.responseJSON(res, 202, manager.start(option.target, option.packageManager));
    } catch (err: any) {
        api.responseError(res, { code: 409, message: err.message });
    }
};

get.apiDoc = {
    summary: 'NeoEPGStation更新情報取得',
    tags: ['system'],
    parameters: [{ name: 'refresh', in: 'query', schema: { type: 'boolean', default: false } }],
    responses: {
        200: {
            description: '更新情報を取得しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SystemUpdateInfo' } } },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};

post.apiDoc = {
    summary: 'NeoEPGStation更新開始',
    tags: ['system'],
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/StartSystemUpdateOption' } } },
    },
    responses: {
        202: {
            description: '更新処理を開始しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SystemUpdateJob' } } },
        },
        default: {
            description: '更新を開始できません',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
