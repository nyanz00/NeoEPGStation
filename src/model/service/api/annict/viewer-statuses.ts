import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import IAnnictApiModel from '../../../api/annict/IAnnictApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';
import { getViewerProfileId } from '../viewerProfileSession';

function ids(value: unknown): number[] {
    if (!Array.isArray(value)) throw new Error('Annict作品IDの一覧が必要です');
    const result = Array.from(new Set(value.map(Number).filter(id => Number.isInteger(id) && id > 0)));
    if (result.length > 500) throw new Error('一度に更新できる作品は500件までです');
    return result;
}

function kind(value: unknown): apid.AnnictViewerStatusKind {
    const result = String(value) as apid.AnnictViewerStatusKind;
    if (!['wanna_watch', 'watching', 'watched', 'on_hold', 'stop_watching', 'no_select'].includes(result)) {
        throw new Error('Annict視聴ステータスが不正です');
    }
    return result;
}

export const post: Operation = async (req, res) => {
    try {
        const viewerProfileId = await getViewerProfileId(req);
        if (viewerProfileId === undefined) throw new Error('視聴者プロフィールを選択してください');
        api.responseJSON(
            res,
            200,
            await container
                .get<IAnnictApiModel>('IAnnictApiModel')
                .getViewerStatuses(ids(req.body?.annictIds), viewerProfileId),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'Annict視聴ステータス取得',
    tags: ['annict'],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
    responses: { 200: { description: '取得しました' }, default: { description: '予期しないエラー' } },
};

export const put: Operation = async (req, res) => {
    try {
        const viewerProfileId = await getViewerProfileId(req);
        if (viewerProfileId === undefined) throw new Error('視聴者プロフィールを選択してください');
        await container
            .get<IAnnictApiModel>('IAnnictApiModel')
            .setViewerStatuses(ids(req.body?.annictIds), kind(req.body?.kind), viewerProfileId);
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'Annict視聴ステータス一括更新',
    tags: ['annict'],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
    responses: { 204: { description: '更新しました' }, default: { description: '予期しないエラー' } },
};
