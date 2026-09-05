import { Operation } from '../../ApiOperation';
import * as apid from '../../../../../api';
import IUserApiModel from '../../../api/user/IUserApiModel';
import IViewerProfileDB from '../../../db/IViewerProfileDB';
import container from '../../../ModelContainer';
import * as api from '../../api';
import { getActiveUserId } from '../activeUser';
import { getViewerProfileId } from '../viewerProfileSession';

export const put: Operation = async (req, res) => {
    const userApiModel = container.get<IUserApiModel>('IUserApiModel');

    try {
        await userApiModel.update(parseInt(req.params.userId, 10), req.body as apid.UpdateUserOption);
        api.responseJSON(res, 200);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

export const del: Operation = async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        if (getActiveUserId(req) !== userId) {
            throw new Error('削除するユーザーへアクティブユーザーを切り替えてください');
        }
        const profile = await container.get<IViewerProfileDB>('IViewerProfileDB').findByTvUserId(userId);
        if (profile !== null && (await getViewerProfileId(req)) !== profile.id) {
            throw new Error('削除するユーザーの外部連携ロックを解除してください');
        }
        await container.get<IUserApiModel>('IUserApiModel').delete(userId);
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

del.apiDoc = {
    summary: 'ユーザー削除',
    tags: ['users'],
    description: '録画、ルール、予約を所有していない現在のアクティブユーザーを削除する',
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
    responses: {
        200: {
            description: 'ユーザーを削除しました',
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
