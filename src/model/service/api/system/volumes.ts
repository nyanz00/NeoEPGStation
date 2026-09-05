import { Operation } from '../../ApiOperation';
import IStorageApiModel from '../../../api/storage/IStorageApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    const storageApiModel = container.get<IStorageApiModel>('IStorageApiModel');
    try {
        api.responseJSON(res, 200, await storageApiModel.getStorageVolumes());
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '接続ストレージ情報取得',
    tags: ['system'],
    description: '録画先以外の接続ストレージ情報を取得する',
    responses: {
        200: {
            description: '接続ストレージ情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/SystemStorageVolumeList',
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
