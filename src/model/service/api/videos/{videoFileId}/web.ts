import { Operation } from '../../../ApiOperation.js';
import IVideoApiModel from '../../../../api/video/IVideoApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';
import { responseRecordedVideo, resolveWebVideoPath } from '../../../RecordedVideoResponse.js';

export const get: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        await responseRecordedVideo(
            req,
            res,
            parseInt(req.params.videoFileId, 10),
            resolveWebVideoPath(videoFileApiModel),
        );
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
