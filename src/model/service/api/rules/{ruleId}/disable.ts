import { Operation } from 'express-openapi';
import IAnnictApiModel from '../../../../api/annict/IAnnictApiModel';
import IRuleApiModel from '../../../../api/rule/IRuleApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const put: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    try {
        const ruleId = parseInt(req.params.ruleId, 10);
        await ruleApiModel.disable(ruleId);
        if (req.query.syncAnnictStopWatching !== 'false') {
            await container.get<IAnnictApiModel>('IAnnictApiModel').syncDisabledRule(ruleId);
        }

        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'ルール無効化',
    tags: ['rules'],
    description: 'ルールを無効化する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRuleId',
        },
        {
            name: 'syncAnnictStopWatching',
            in: 'query',
            required: false,
            description: 'Annict経由の最後の有効ルールなら作品を「中止」にする',
            schema: { type: 'boolean', default: true },
        },
    ],
    responses: {
        200: {
            description: 'ルールを無効化しました',
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
