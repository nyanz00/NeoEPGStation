import * as apid from '../../../../../api';
import { AutoEncodeSettingsValidationError } from '../../../encode/AutoEncodeSettingsModel';
import IAutoEncodeSettingsModel from '../../../encode/IAutoEncodeSettingsModel';
import container from '../../../ModelContainer';
import { Operation } from '../../ApiOperation';
import * as api from '../../api';
import { AdminAccessError, requireActiveAdmin } from '../adminAccess';

export const get: Operation = async (_req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container.get<IAutoEncodeSettingsModel>('IAutoEncodeSettingsModel').getSettings(),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

export const put: Operation = async (req, res) => {
    try {
        await requireActiveAdmin(req);
        api.responseJSON(
            res,
            200,
            await container
                .get<IAutoEncodeSettingsModel>('IAutoEncodeSettingsModel')
                .updateSettings(req.body as apid.UpdateAutoEncodeSettingsOption),
        );
    } catch (err: any) {
        api.responseError(res, {
            code: err instanceof AdminAccessError ? 403 : err instanceof AutoEncodeSettingsValidationError ? 400 : 500,
            message: err.message,
        });
    }
};

const response = {
    description: 'サーバー共通の自動エンコード設定',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/AutoEncodeSettings' } } },
};

get.apiDoc = {
    summary: '自動エンコード設定取得',
    tags: ['encode'],
    responses: { 200: response, default: { description: '設定を取得できません' } },
};

put.apiDoc = {
    summary: '自動エンコード設定更新',
    tags: ['encode'],
    requestBody: {
        required: true,
        content: {
            'application/json': { schema: { $ref: '#/components/schemas/UpdateAutoEncodeSettingsOption' } },
        },
    },
    responses: {
        200: response,
        400: { description: '設定値が不正です' },
        403: { description: '管理者ユーザーのみ変更できます' },
        default: { description: '設定を更新できません' },
    },
};
