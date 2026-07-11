import { Operation } from 'express-openapi';
import * as apid from '../../../../../../api';
import IRecordedApiModel from '../../../../api/recorded/IRecordedApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const put: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        await recordedApiModel.changeUser(
            parseInt(req.params.recordedId, 10),
            req.body as apid.UpdateRecordedUserOption,
        );
        api.responseJSON(res, 200);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: '録画ユーザー更新',
    tags: ['recorded'],
    description: '録画に紐づくユーザーを更新する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRecordedId',
        },
    ],
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/UpdateRecordedUserOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: '録画ユーザーを更新しました',
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
