import { Operation } from '../../ApiOperation';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        let userId: number | undefined;
        if (typeof req.query.userId !== 'undefined') {
            if (typeof req.query.userId !== 'string' || !/^[1-9]\d*$/.test(req.query.userId)) {
                throw new Error('ユーザーIDが不正です');
            }
            userId = Number(req.query.userId);
            if (!Number.isSafeInteger(userId)) throw new Error('ユーザーIDが不正です');
        }

        const list = await recordedApiModel.getSearchOptionList(userId);
        api.responseJSON(res, 200, list);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画検索オプションを取得',
    tags: ['recorded'],
    description: '録画検索オプションを取得する',
    parameters: [
        {
            name: 'userId',
            in: 'query',
            description: '録画検索件数を集計するユーザーID（省略時は全ユーザー）',
            schema: {
                $ref: '#/components/schemas/UserId',
            },
        },
    ],
    responses: {
        200: {
            description: '録画検索オプションを取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RecordedSearchOptions',
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
