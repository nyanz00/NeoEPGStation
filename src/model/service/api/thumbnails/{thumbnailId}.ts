import { Operation } from '../../ApiOperation.js';
import IThumbnailApiModel from '../../../api/thumbnail/IThumbnailApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

export const get: Operation = async (req, res) => {
    const thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');
    const noCache = 'private, no-cache, no-store, must-revalidate';
    res.setHeader('Cache-Control', noCache);

    try {
        const filePath = await thumbnailApiModel.getIdFilePath(parseInt(req.params.thumbnailId, 10));

        if (filePath === null) {
            api.responseError(res, {
                code: 404,
                message: 'thumbnail is not Found',
            });
        } else {
            res.setHeader('Cache-Control', 'private, max-age=14400');
            api.responseFile(req, res, filePath, 'image/jpeg', false);
        }
    } catch (err: any) {
        res.setHeader('Cache-Control', noCache);
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'サムネイル',
    tags: ['thumbnails'],
    description: 'サムネイルを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathThumbnailId',
        },
    ],
    responses: {
        200: {
            description: 'サムネイルを取得しました',
            content: {
                'image/jpeg': {},
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

export const del: Operation = async (req, res) => {
    const thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');

    try {
        await thumbnailApiModel.delete(parseInt(req.params.thumbnailId, 10));

        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'サムネイル',
    tags: ['thumbnails'],
    description: 'サムネイルを削除する',
    parameters: [
        {
            $ref: '#/components/parameters/PathThumbnailId',
        },
    ],
    responses: {
        200: {
            description: 'サムネイルを削除しました',
            content: {
                'image/jpeg': {},
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
