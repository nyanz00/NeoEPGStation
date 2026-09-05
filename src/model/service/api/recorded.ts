import { Operation } from '../ApiOperation';
import { GetRecordedOption } from '../../../../api';
import IRecordedApiModel from '../../api/recorded/IRecordedApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        const option: GetRecordedOption = {
            isHalfWidth: req.query.isHalfWidth as any as boolean,
        };
        if (typeof req.query.offset !== 'undefined') {
            option.offset = parseInt(req.query.offset as any, 10);
        }
        if (typeof req.query.limit !== 'undefined') {
            option.limit = parseInt(req.query.limit as any, 10);
        }
        if (typeof req.query.isReverse !== 'undefined') {
            option.isReverse = req.query.isReverse as any;
        }
        if (typeof req.query.ruleId !== 'undefined') {
            option.ruleId = parseInt(req.query.ruleId as any, 10);
        }
        if (typeof req.query.userId !== 'undefined') {
            option.userId = parseInt(req.query.userId as any, 10);
        }
        if (typeof req.query.channelId !== 'undefined') {
            option.channelId = parseInt(req.query.channelId as any, 10);
        }
        if (typeof req.query.genre !== 'undefined') {
            option.genre = parseInt(req.query.genre as any, 10);
        }
        if (typeof req.query.keyword === 'string') {
            option.keyword = req.query.keyword;
        }
        if (typeof req.query.hasOriginalFile !== 'undefined') {
            option.hasOriginalFile = req.query.hasOriginalFile as any;
        }
        if (typeof req.query.encodeMode === 'string') {
            option.encodeMode = req.query.encodeMode;
        }
        option.encodeModes = parseStringArrayQuery(req.query.encodeModes ?? req.query['encodeModes[]']);
        if (req.query.encodeModeMatch === 'include' || req.query.encodeModeMatch === 'only') {
            option.encodeModeMatch = req.query.encodeModeMatch;
        }
        if (typeof req.query.hasDrop !== 'undefined') {
            option.hasDrop = (req.query.hasDrop as any) === true || req.query.hasDrop === 'true';
        }
        if (typeof req.query.hasError !== 'undefined') {
            option.hasError = (req.query.hasError as any) === true || req.query.hasError === 'true';
        }
        if (typeof req.query.hasScrambling !== 'undefined') {
            option.hasScrambling = (req.query.hasScrambling as any) === true || req.query.hasScrambling === 'true';
        }
        if (typeof req.query.recordedStartAt !== 'undefined') {
            option.recordedStartAt = parseInt(req.query.recordedStartAt as any, 10);
        }
        if (typeof req.query.recordedEndAt !== 'undefined') {
            option.recordedEndAt = parseInt(req.query.recordedEndAt as any, 10);
        }

        api.responseJSON(res, 200, await recordedApiModel.gets(option));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

const parseStringArrayQuery = (value: unknown): string[] => {
    if (typeof value === 'undefined' || value === null) {
        return [];
    }
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
    }
    if (typeof value === 'string' && value.length > 0) {
        return [value];
    }

    return [];
};

get.apiDoc = {
    summary: '録画情報取得',
    tags: ['recorded'],
    description: '録画情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
        {
            $ref: '#/components/parameters/Offset',
        },
        {
            $ref: '#/components/parameters/Limit',
        },
        {
            $ref: '#/components/parameters/IsReverse',
        },
        {
            $ref: '#/components/parameters/QueryRuleId',
        },
        {
            name: 'userId',
            in: 'query',
            description: 'ユーザーID',
            schema: {
                $ref: '#/components/schemas/UserId',
            },
        },
        {
            $ref: '#/components/parameters/QueryChannelId',
        },
        {
            $ref: '#/components/parameters/QueryProgramGenre',
        },
        {
            $ref: '#/components/parameters/QueryKeyword',
        },
        {
            $ref: '#/components/parameters/QueryHasOriginalFile',
        },
        {
            name: 'encodeMode',
            in: 'query',
            description: 'エンコードプリセット名',
            schema: {
                type: 'string',
            },
        },
        {
            name: 'encodeModeMatch',
            in: 'query',
            description: 'エンコードプリセットの一致条件',
            schema: {
                type: 'string',
                enum: ['include', 'only'],
            },
        },
        {
            name: 'hasDrop',
            in: 'query',
            description: 'drop がある録画のみ',
            schema: {
                type: 'boolean',
            },
        },
        {
            name: 'hasError',
            in: 'query',
            description: 'error がある録画のみ',
            schema: {
                type: 'boolean',
            },
        },
        {
            name: 'hasScrambling',
            in: 'query',
            description: 'scrambling がある録画のみ',
            schema: {
                type: 'boolean',
            },
        },
        {
            name: 'recordedStartAt',
            in: 'query',
            description: '録画開始日時下限',
            schema: {
                $ref: '#/components/schemas/UnixtimeMS',
            },
        },
        {
            name: 'recordedEndAt',
            in: 'query',
            description: '録画開始日時上限',
            schema: {
                $ref: '#/components/schemas/UnixtimeMS',
            },
        },
    ],
    responses: {
        200: {
            description: '録画情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Records',
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

export const post: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        api.responseJSON(res, 201, {
            recordedId: await recordedApiModel.createNewRecorded(req.body),
        });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画番組情報の新規作成',
    tags: ['recorded'],
    description: '録画番組情報を新規作成する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/CreateNewRecordedOption',
                },
            },
        },
        required: true,
    },
    responses: {
        201: {
            description: '録画番組情報の新規作成に成功した',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/CreatedNewRecorded',
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
