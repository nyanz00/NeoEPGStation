import { Operation } from '../../../ApiOperation';
import * as apid from '../../../../../../api';
import IUserApiModel from '../../../../api/user/IUserApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
import { AdminAccessError, requireActiveAdmin } from '../../adminAccess';

export const put: Operation = async (req, res) => {
    const option: unknown = req.body;
    const userId = Number(req.params.userId);
    if (
        !Number.isInteger(userId) ||
        userId <= 0 ||
        typeof option !== 'object' ||
        option === null ||
        !('isAdmin' in option) ||
        typeof option.isAdmin !== 'boolean'
    ) {
        api.responseError(res, { code: 400, message: '管理者権限の指定が不正です' });
        return;
    }
    try {
        const actorUserId = await requireActiveAdmin(req);
        await container
            .get<IUserApiModel>('IUserApiModel')
            .updateAdmin(actorUserId, userId, option as apid.UpdateUserAdminOption);
        api.responseJSON(res, 200);
    } catch (err: any) {
        if (err instanceof AdminAccessError) api.responseError(res, { code: 403, message: err.message });
        else api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'ユーザーの管理者権限変更',
    tags: ['users'],
    parameters: [{ name: 'userId', in: 'path', required: true, schema: { $ref: '#/components/schemas/UserId' } }],
    requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateUserAdminOption' } } },
    },
    responses: {
        200: { description: '管理者権限を変更しました' },
        400: { description: '不正な指定です' },
        403: { description: '管理者のみが変更できます' },
        default: {
            description: '変更できません',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};
