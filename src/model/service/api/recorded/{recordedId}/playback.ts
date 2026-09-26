import { Operation } from '../../../ApiOperation';
import * as apid from '../../../../../../api';
import IRecordedPlaybackApiModel from '../../../../api/recorded/IRecordedPlaybackApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
import { getActiveUserId } from '../../activeUser';

function recordedId(value: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new Error('録画IDが不正です');
    return id;
}

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IRecordedPlaybackApiModel>('IRecordedPlaybackApiModel')
                .get(recordedId(req.params.recordedId), getActiveUserId(req)),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'アクティブユーザーの録画再生進捗を取得',
    tags: ['recorded'],
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }],
    responses: {
        200: {
            description: '取得しました',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/RecordedPlayback' },
                },
            },
        },
        default: { description: '予期しないエラー' },
    },
};

export const put: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IRecordedPlaybackApiModel>('IRecordedPlaybackApiModel')
                .update(
                    recordedId(req.params.recordedId),
                    getActiveUserId(req),
                    req.body as apid.UpdateRecordedPlaybackOption,
                ),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

export const del: Operation = async (req, res) => {
    try {
        await container
            .get<IRecordedPlaybackApiModel>('IRecordedPlaybackApiModel')
            .removeFromHistory(recordedId(req.params.recordedId), getActiveUserId(req));
        api.responseJSON(res, 200, { result: 'success' });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'アクティブユーザーの録画再生進捗を保存',
    tags: ['recorded'],
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/UpdateRecordedPlaybackOption' },
            },
        },
    },
    responses: {
        200: {
            description: '保存しました',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/RecordedPlayback' },
                },
            },
        },
        default: { description: '予期しないエラー' },
    },
};

del.apiDoc = {
    summary: 'アクティブユーザーの視聴履歴から録画番組を削除',
    tags: ['recorded'],
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }],
    responses: {
        200: { description: '視聴履歴から削除しました' },
        default: { description: '予期しないエラー' },
    },
};
