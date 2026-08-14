import { Operation } from 'express-openapi';
import * as apid from '../../../../../../api';
import IRecordedApiModel from '../../../../api/recorded/IRecordedApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const put: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        api.responseJSON(
            res,
            200,
            await recordedApiModel.moveToSubDirectory(req.body as apid.MoveRecordedSubDirectoryOption),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: '録画ファイル一括サブディレクトリ移動',
    tags: ['recorded'],
    description: '複数の録画に紐づく動画ファイルを指定サブディレクトリへ一括移動する',
    requestBody: {
        required: true,
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/MoveRecordedSubDirectoryOption',
                },
            },
        },
    },
    responses: {
        200: {
            description: '録画ファイルを移動しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/BulkRecordedOperationResult',
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
