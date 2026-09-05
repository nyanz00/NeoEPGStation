import { Operation } from '../ApiOperation';
import * as apid from '../../../../api';
import IViewerProfileApiModel from '../../api/viewerProfile/IViewerProfileApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (_req, res) => {
    try {
        api.responseJSON(res, 200, await container.get<IViewerProfileApiModel>('IViewerProfileApiModel').gets());
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};
get.apiDoc = {
    summary: '視聴者プロフィール一覧',
    tags: ['viewer-profiles'],
    responses: { 200: { description: '取得しました' } },
};

export const post: Operation = async (req, res) => {
    try {
        const profileId = await container
            .get<IViewerProfileApiModel>('IViewerProfileApiModel')
            .add(req.body as apid.CreateViewerProfileOption);
        api.responseJSON(res, 201, { profileId });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};
post.apiDoc = {
    summary: '視聴者プロフィール作成',
    tags: ['viewer-profiles'],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
    responses: { 201: { description: '作成しました' } },
};
