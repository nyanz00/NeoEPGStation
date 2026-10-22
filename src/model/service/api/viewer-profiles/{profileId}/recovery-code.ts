import { Operation } from '../../../ApiOperation.js';
import IViewerProfileApiModel from '../../../../api/viewerProfile/IViewerProfileApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';
import { getViewerProfileId } from '../../viewerProfileSession.js';

export const post: Operation = async (req, res) => {
    try {
        const profileId = Number(req.params.profileId);
        if ((await getViewerProfileId(req)) !== profileId) {
            throw new Error('別の視聴者プロフィールの回復コードは変更できません');
        }
        api.responseJSON(
            res,
            200,
            await container.get<IViewerProfileApiModel>('IViewerProfileApiModel').rotateRecoveryCode(profileId),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '視聴者プロフィールの回復コードを再発行',
    tags: ['viewer-profiles'],
    parameters: [{ name: 'profileId', in: 'path', required: true, schema: { type: 'integer' } }],
    responses: { 200: { description: '回復コードを再発行しました' } },
};
