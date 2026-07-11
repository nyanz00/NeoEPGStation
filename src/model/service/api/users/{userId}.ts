import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import IUserApiModel from '../../../api/user/IUserApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const put: Operation = async (req, res) => {
    const userApiModel = container.get<IUserApiModel>('IUserApiModel');

    try {
        await userApiModel.update(parseInt(req.params.userId, 10), req.body as apid.UpdateUserOption);
        api.responseJSON(res, 200);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'ユーザー更新',
    tags: ['users'],
    description: 'ユーザー情報を更新する',
    parameters: [
        {
            name: 'userId',
            in: 'path',
            required: true,
            schema: {
                $ref: '#/components/schemas/UserId',
            },
        },
    ],
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/UpdateUserOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: 'ユーザー情報を更新しました',
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
