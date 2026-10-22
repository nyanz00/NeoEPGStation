import { Operation } from '../../../ApiOperation.js';
import * as apid from '../../../../../../api.js';
import IRecordedPlaybackApiModel from '../../../../api/recorded/IRecordedPlaybackApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';
import { getActiveUserId } from '../../activeUser.js';

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IRecordedPlaybackApiModel>('IRecordedPlaybackApiModel')
                .getHistorySettings(getActiveUserId(req)),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

export const put: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IRecordedPlaybackApiModel>('IRecordedPlaybackApiModel')
                .updateHistorySettings(
                    getActiveUserId(req),
                    req.body as apid.UpdateRecordedPlaybackHistorySettingsOption,
                ),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

const response = {
    description: '視聴履歴保存設定',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordedPlaybackHistorySettings' } } },
};

get.apiDoc = {
    summary: 'アクティブユーザーの視聴履歴保存設定を取得',
    tags: ['recorded'],
    responses: { 200: response, default: { description: '予期しないエラー' } },
};

put.apiDoc = {
    summary: 'アクティブユーザーの視聴履歴保存設定を更新',
    tags: ['recorded'],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/UpdateRecordedPlaybackHistorySettingsOption' },
            },
        },
    },
    responses: { 200: response, default: { description: '予期しないエラー' } },
};
