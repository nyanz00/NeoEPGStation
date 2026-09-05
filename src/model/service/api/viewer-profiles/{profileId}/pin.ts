import { Operation } from '../../../ApiOperation';
import IViewerProfileApiModel from '../../../../api/viewerProfile/IViewerProfileApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
import { getViewerProfileId } from '../../viewerProfileSession';

export const put: Operation = async (req, res) => {
    try {
        const profileId = Number(req.params.profileId);
        if ((await getViewerProfileId(req)) !== profileId)
            throw new Error('別の視聴者プロフィールの連携ロックは変更できません');
        const pin = typeof req.body?.pin === 'string' ? req.body.pin : undefined;
        api.responseJSON(
            res,
            200,
            await container.get<IViewerProfileApiModel>('IViewerProfileApiModel').updatePin(profileId, pin),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};
put.apiDoc = {
    summary: '視聴者プロフィールの旧PINを変更または解除',
    tags: ['viewer-profiles'],
    parameters: [{ name: 'profileId', in: 'path', required: true, schema: { type: 'integer' } }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
    responses: { 200: { description: '連携ロック設定を更新しました' } },
};
