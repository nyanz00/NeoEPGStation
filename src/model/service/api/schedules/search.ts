import { Operation } from '../../ApiOperation.js';
import IScheduleApiModel from '../../../api/schedule/IScheduleApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

export const post: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    try {
        api.responseJSON(
            res,
            200,
            await scheduleApiModel.search(req.body.option, req.body.isHalfWidth, req.body.limit),
        );
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '番組検索結果を取得',
    tags: ['schedules'],
    description: '番組検索結果を取得する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/ScheduleSearchOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: '番組検索結果を取得しました',
            content: {
                'application/json': {
                    schema: {
                        type: 'array',
                        items: {
                            $ref: '#/components/schemas/ScheduleProgramItem',
                        },
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
