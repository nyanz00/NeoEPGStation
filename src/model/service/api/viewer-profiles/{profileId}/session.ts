import { Operation } from '../../../ApiOperation';
import IViewerProfileApiModel from '../../../../api/viewerProfile/IViewerProfileApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    try {
        const profileId = Number(req.params.profileId);
        const headerProfileId = Number(req.header('x-viewer-profile-id'));
        if (!Number.isInteger(profileId) || profileId <= 0 || headerProfileId !== profileId) {
            throw new Error('視聴者プロフィールIDが不正です');
        }
        const valid = await container
            .get<IViewerProfileApiModel>('IViewerProfileApiModel')
            .authenticate(profileId, req.header('x-viewer-session') ?? '');
        api.responseJSON(res, 200, { valid });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};
get.apiDoc = {
    summary: '視聴者プロフィールの解除セッション確認',
    tags: ['viewer-profiles'],
    parameters: [{ name: 'profileId', in: 'path', required: true, schema: { type: 'integer' } }],
    responses: { 200: { description: 'セッション状態を取得しました' } },
};
