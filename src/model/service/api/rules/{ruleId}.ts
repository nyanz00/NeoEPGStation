import { Operation } from 'express-openapi';
import IAnnictApiModel from '../../../api/annict/IAnnictApiModel';
import IRuleApiModel from '../../../api/rule/IRuleApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    try {
        const rule = await ruleApiModel.get(parseInt(req.params.ruleId, 10));
        if (rule !== null) {
            api.responseJSON(res, 200, rule);
        } else {
            api.responseError(res, {
                code: 404,
                message: 'Rule is not Found',
            });
        }
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ルール取得',
    tags: ['rules'],
    description: 'ルールを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRuleId',
        },
    ],
    responses: {
        200: {
            description: 'ルールを削除しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Rule',
                    },
                },
            },
        },
        404: {
            description: '指定された id の rule がない',
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

export const del: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    try {
        const ruleId = parseInt(req.params.ruleId, 10);
        await ruleApiModel.delete(ruleId);
        await container.get<IAnnictApiModel>('IAnnictApiModel').unlinkRule(ruleId);
        api.responseJSON(res, 200, {
            code: 200,
        });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'ルール削除',
    tags: ['rules'],
    description: 'ルールを削除する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRuleId',
        },
    ],
    responses: {
        200: {
            description: 'ルールを削除しました',
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

export const put: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    const rule = req.body;
    const ruleId = parseInt(req.params.ruleId, 10);
    rule.id = ruleId;
    try {
        const previous = await ruleApiModel.get(ruleId);
        await ruleApiModel.update(rule);
        if (
            previous?.reserveOption.enable === true &&
            rule.reserveOption?.enable === false &&
            req.query.syncAnnictStopWatching !== 'false'
        ) {
            await container.get<IAnnictApiModel>('IAnnictApiModel').syncDisabledRule(ruleId);
        } else if (previous?.reserveOption.enable === false && rule.reserveOption?.enable === true) {
            await container.get<IAnnictApiModel>('IAnnictApiModel').syncEnabledRule(ruleId);
        }
        api.responseJSON(res, 200, {
            code: 200,
        });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'ルール更新',
    tags: ['rules'],
    description: 'ルールを更新する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRuleId',
        },
        {
            name: 'syncAnnictStopWatching',
            in: 'query',
            required: false,
            description: '無効化時、Annict経由の最後の有効ルールなら作品を「中止」にする',
            schema: { type: 'boolean', default: true },
        },
    ],
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/AddRuleOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: 'ルールの更新に成功した',
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
