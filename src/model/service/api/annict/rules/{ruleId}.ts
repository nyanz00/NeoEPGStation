import { Operation } from 'express-openapi';
import IAnnictApiModel from '../../../../api/annict/IAnnictApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';
import { getViewerProfileId } from '../../viewerProfileSession';

export const put: Operation = async (req, res) => {
    try {
        const ruleId = Number(req.params.ruleId);
        const annictId = Number(req.body?.annictId);
        await container
            .get<IAnnictApiModel>('IAnnictApiModel')
            .linkRule(ruleId, annictId, await getViewerProfileId(req));
        api.responseJSON(res, 204);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'ルールとAnnict作品を関連付ける',
    tags: ['annict'],
    parameters: [{ $ref: '#/components/parameters/PathRuleId' }],
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
    responses: { 204: { description: '関連付けました' }, default: { description: '予期しないエラー' } },
};
