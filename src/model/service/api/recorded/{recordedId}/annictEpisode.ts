import { Operation } from 'express-openapi';
import * as apid from '../../../../../../api';
import IAnnictApiModel from '../../../../api/annict/IAnnictApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
import { getViewerProfileId } from '../../viewerProfileSession';

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
                .get<IAnnictApiModel>('IAnnictApiModel')
                .getRecordedEpisode(recordedId(req.params.recordedId), await getViewerProfileId(req, false)),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画番組のAnnictエピソード対応を取得',
    tags: ['annict', 'recorded'],
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }],
    responses: {
        200: {
            description: '取得しました',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/AnnictRecordedEpisodeInfo' },
                },
            },
        },
        default: { description: '予期しないエラー' },
    },
};

export const post: Operation = async (req, res) => {
    try {
        const id = recordedId(req.params.recordedId);
        const model = container.get<IAnnictApiModel>('IAnnictApiModel');
        await model.matchRecordedEpisode(id, true);
        api.responseJSON(res, 200, await model.getRecordedEpisode(id, await getViewerProfileId(req, false)));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画番組とAnnictエピソードを再照合',
    tags: ['annict', 'recorded'],
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }],
    responses: {
        200: {
            description: '再照合しました',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/AnnictRecordedEpisodeInfo' },
                },
            },
        },
        default: { description: '予期しないエラー' },
    },
};

export const put: Operation = async (req, res) => {
    try {
        const profileId = await getViewerProfileId(req);
        if (profileId === undefined) throw new Error('視聴者プロフィールを選択してください');
        const option: apid.AnnictEpisodeWatchOption = {
            markWorkWatchedOnFinalEpisode: req.body?.markWorkWatchedOnFinalEpisode !== false,
            disableRulesOnFinalEpisode: req.body?.disableRulesOnFinalEpisode !== false,
        };
        api.responseJSON(
            res,
            200,
            await container
                .get<IAnnictApiModel>('IAnnictApiModel')
                .markRecordedEpisodeWatched(recordedId(req.params.recordedId), profileId, option),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: '録画番組に対応するAnnictエピソードを視聴済みにする',
    tags: ['annict', 'recorded'],
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }],
    requestBody: {
        required: false,
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/AnnictEpisodeWatchOption' },
            },
        },
    },
    responses: {
        200: {
            description: '視聴済みにしました',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/AnnictRecordedEpisodeInfo' },
                },
            },
        },
        default: { description: '予期しないエラー' },
    },
};

export const del: Operation = async (req, res) => {
    try {
        const profileId = await getViewerProfileId(req);
        if (profileId === undefined) throw new Error('視聴者プロフィールを選択してください');
        api.responseJSON(
            res,
            200,
            await container
                .get<IAnnictApiModel>('IAnnictApiModel')
                .unmarkRecordedEpisodeWatched(recordedId(req.params.recordedId), profileId),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: '録画番組に対応するAnnictエピソードの視聴記録を削除',
    tags: ['annict', 'recorded'],
    parameters: [{ $ref: '#/components/parameters/PathRecordedId' }],
    responses: {
        200: {
            description: '視聴記録を削除しました',
            content: {
                'application/json': {
                    schema: { $ref: '#/components/schemas/AnnictRecordedEpisodeInfo' },
                },
            },
        },
        default: { description: '予期しないエラー' },
    },
};
