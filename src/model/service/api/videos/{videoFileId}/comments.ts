import IVideoCommentApiModel from '../../../../api/video/IVideoCommentApiModel';
import { VideoCommentRequestError } from '../../../../api/video/VideoCommentApiModel';
import container from '../../../../ModelContainer';
import { Operation } from '../../../ApiOperation';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    try {
        // OpenAPI's integer coercer truncates fractional query values. Validate the original
        // value so clients never receive a different subtitle track from the one requested.
        const url = new URL(req.originalUrl, 'http://localhost');
        const rawVideoFileId = url.pathname.match(/\/videos\/([^/]+)\/comments\/?$/)?.[1];
        if (
            rawVideoFileId === undefined ||
            !/^[0-9]+$/.test(rawVideoFileId) ||
            !Number.isSafeInteger(Number(rawVideoFileId))
        ) {
            throw new VideoCommentRequestError(400, 'VideoFileIdIsInvalid');
        }
        const query = url.searchParams;
        const indexes = query.getAll('subtitleIndex');
        if (
            indexes.length > 1 ||
            (indexes.length === 1 && (!/^[0-9]+$/.test(indexes[0]) || !Number.isSafeInteger(Number(indexes[0]))))
        ) {
            throw new VideoCommentRequestError(400, 'SubtitleIndexIsInvalid');
        }
        const subtitleIndex = indexes.length === 0 ? undefined : Number(indexes[0]);
        const result = await container
            .get<IVideoCommentApiModel>('IVideoCommentApiModel')
            .getComments(Number(rawVideoFileId), subtitleIndex);
        api.responseJSON(res, 200, result);
    } catch (err: any) {
        if (err instanceof VideoCommentRequestError) {
            api.responseError(res, { code: err.code, message: err.message });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: 'PLAY・STREAMING共通の弾幕コメントを取得',
    description: 'TSは実況過去ログ、encodedは指定字幕を解析する。timeは映像ファイル先頭からの秒数。',
    tags: ['videos'],
    parameters: [
        { $ref: '#/components/parameters/PathVideoFileId' },
        {
            name: 'subtitleIndex',
            in: 'query',
            description: 'encodedでは必須。TSでは指定しない。字幕一覧APIのsubtitleIndexを使用する。',
            required: false,
            schema: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        },
    ],
    responses: {
        200: {
            description: '再生方式に依存しないコメント一覧',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoComments' } } },
        },
        400: { description: '字幕の指定が不正です' },
        404: { description: '映像が存在しません' },
        default: { description: 'コメントを取得できません' },
    },
};
