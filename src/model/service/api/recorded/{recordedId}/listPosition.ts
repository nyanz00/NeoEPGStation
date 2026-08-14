import { Operation } from 'express-openapi';
import IRecordedApiModel from '../../../../api/recorded/IRecordedApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    try {
        api.responseJSON(
            res,
            200,
            await container
                .get<IRecordedApiModel>('IRecordedApiModel')
                .getListPosition(Number(req.params.recordedId), Number(req.query.limit)),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画済み一覧における対象録画のページ位置を取得',
    tags: ['recorded'],
    parameters: [
        { $ref: '#/components/parameters/PathRecordedId' },
        { in: 'query', name: 'limit', required: true, schema: { type: 'integer', minimum: 1, maximum: 1000 } },
    ],
    responses: {
        200: {
            description: 'ページ位置を取得しました',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RecordedListPosition' } } },
        },
        default: { description: '予期しないエラー' },
    },
};
