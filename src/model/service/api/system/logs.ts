import { Operation } from 'express-openapi';
import * as apid from '../../../../../api';
import IStorageApiModel from '../../../api/storage/IStorageApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

const sources: apid.SystemLogSource[] = ['Operator', 'Service', 'EPGUpdater'];
const categories: apid.SystemLogCategory[] = ['system', 'access', 'stream', 'encode'];

export const get: Operation = async (req, res) => {
    const storageApiModel = container.get<IStorageApiModel>('IStorageApiModel');
    const source = sources.includes(req.query.source as apid.SystemLogSource)
        ? (req.query.source as apid.SystemLogSource)
        : 'Operator';
    const category = categories.includes(req.query.category as apid.SystemLogCategory)
        ? (req.query.category as apid.SystemLogCategory)
        : 'system';
    const requestedLines = Number(req.query.lines);
    const lines = Number.isFinite(requestedLines) ? requestedLines : 500;

    try {
        api.responseJSON(res, 200, await storageApiModel.getLog(source, category, lines));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'システムログ取得',
    tags: ['system'],
    description: 'NeoEPGStation標準ログの末尾を取得する',
    parameters: [
        {
            name: 'source',
            in: 'query',
            schema: { type: 'string', enum: sources, default: 'Operator' },
        },
        {
            name: 'category',
            in: 'query',
            schema: { type: 'string', enum: categories, default: 'system' },
        },
        {
            name: 'lines',
            in: 'query',
            schema: { type: 'integer', minimum: 50, maximum: 2000, default: 500 },
        },
    ],
    responses: {
        200: {
            description: 'ログを取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/SystemLogInfo',
                    },
                },
            },
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
