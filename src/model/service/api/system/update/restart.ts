import { Operation } from 'express-openapi';
import UpdateManager from '../../../../update/UpdateManager';
import * as api from '../../../api';

export const post: Operation = async (_req, res) => {
    try {
        UpdateManager.getInstance().requestRestart();
        api.responseJSON(res, 202, { accepted: true });
    } catch (err: any) {
        api.responseError(res, { code: 409, message: err.message });
    }
};

post.apiDoc = {
    summary: '更新後のNeoEPGStation再起動',
    tags: ['system'],
    responses: {
        202: {
            description: '再起動要求を受け付けました',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['accepted'],
                        properties: { accepted: { type: 'boolean' } },
                    },
                },
            },
        },
        default: {
            description: '再起動できません',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
