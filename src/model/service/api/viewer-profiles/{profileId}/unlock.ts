import { Operation } from '../../../ApiOperation';
import IViewerProfileApiModel from '../../../../api/viewerProfile/IViewerProfileApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    try {
        const result = await container
            .get<IViewerProfileApiModel>('IViewerProfileApiModel')
            .unlock(Number(req.params.profileId), String(req.body?.password ?? req.body?.pin ?? ''));
        api.responseJSON(res, 200, result);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};
post.apiDoc = {
    summary: '視聴者プロフィールのロック解除',
    tags: ['viewer-profiles'],
    parameters: [{ name: 'profileId', in: 'path', required: true, schema: { type: 'integer' } }],
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    properties: {
                        password: { type: 'string' },
                        pin: { type: 'string', deprecated: true },
                    },
                },
            },
        },
    },
    responses: { 200: { description: '解除しました' } },
};
