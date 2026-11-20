import { Operation } from '../../ApiOperation.js';
import IStorageApiModel from '../../../api/storage/IStorageApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

export const get: Operation = async (_req, res) => {
    const storageApiModel = container.get<IStorageApiModel>('IStorageApiModel');
    try {
        api.responseJSON(res, 200, await storageApiModel.getSystemInfo());
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'システムリソース情報取得',
    tags: ['system'],
    description: 'サーバーマシンのCPU、メモリ、プロセス情報を取得する',
    responses: {
        200: {
            description: 'システムリソース情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/SystemResourceInfo',
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
