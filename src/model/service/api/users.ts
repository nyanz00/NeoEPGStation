import { Operation } from 'express-openapi';
import * as apid from '../../../../api';
import IUserApiModel from '../../api/user/IUserApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (_req, res) => {
    const userApiModel = container.get<IUserApiModel>('IUserApiModel');

    try {
        api.responseJSON(res, 200, await userApiModel.gets());
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ユーザー情報取得',
    tags: ['users'],
    description: 'ユーザー情報を取得する',
    responses: {
        200: {
            description: 'ユーザー情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Users',
                    },
                },
            },
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

export const post: Operation = async (req, res) => {
    const userApiModel = container.get<IUserApiModel>('IUserApiModel');

    try {
        api.responseJSON(res, 201, {
            userId: await userApiModel.add(req.body as apid.AddUserOption),
        });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'ユーザー追加',
    tags: ['users'],
    description: 'ユーザーを追加する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/AddUserOption',
                },
            },
        },
        required: true,
    },
    responses: {
        201: {
            description: 'ユーザーの追加に成功した',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            userId: {
                                $ref: '#/components/schemas/UserId',
                            },
                        },
                    },
                },
            },
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
