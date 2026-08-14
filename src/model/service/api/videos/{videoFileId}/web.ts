import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const fileInfo = await videoFileApiModel.getWebPlaybackFilePath(parseInt(req.params.videoFileId, 10));
        if (fileInfo === null) {
            api.responseError(res, {
                code: 404,
                message: 'video file is not found',
            });
            return;
        }

        api.responseFile(req, res, fileInfo.path, fileInfo.mime, false);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'WebKit互換ビデオファイル',
    tags: ['videos'],
    description: 'WebKitが直接扱えないMatroska録画は、映像と音声を再エンコードせずMP4へリマックスして取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: 'WebKitで再生可能なビデオファイルを取得しました',
            content: {
                'video/mp4': {},
                'video/quicktime': {},
                'video/x-m4v': {},
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
