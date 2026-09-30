import { Operation } from '../../../ApiOperation';
import UpdateManager from '../../../../update/UpdateManager';
import * as api from '../../../api';
import { AdminAccessError, requireActiveAdmin } from '../../adminAccess';

export const post: Operation = async (req, res) => {
    try {
        await requireActiveAdmin(req);
        UpdateManager.getInstance().requestRestart();
        api.responseJSON(res, 202, { accepted: true });
    } catch (err: any) {
        api.responseError(res, { code: err instanceof AdminAccessError ? 403 : 409, message: err.message });
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
        403: { description: '管理者ユーザーのみ再起動できます' },
        default: {
            description: '再起動できません',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
