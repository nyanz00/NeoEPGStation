import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (_req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        api.responseJSON(res, 200, await recordedApiModel.getSubDirectories());
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画サブディレクトリ一覧取得',
    tags: ['recorded'],
    description: '録画保存先に存在するサブディレクトリを取得する',
    responses: {
        200: {
            description: '録画サブディレクトリを取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RecordedSubDirectories',
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
