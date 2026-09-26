import { Operation } from '../../../../../ApiOperation';
import IVideoApiModel from '../../../../../../api/video/IVideoApiModel';
import container from '../../../../../../ModelContainer';
import * as api from '../../../../../api';

export const post: Operation = async (req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const result = await videoApiModel.prepareSubtitle(
            parseInt(req.params.videoFileId, 10),
            parseInt(req.params.subtitleIndex, 10),
        );
        res.status(200).json(result);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'ビデオファイル内の字幕トラックを準備',
    tags: ['videos'],
    description: '指定したビデオファイルに含まれる字幕トラックを一時 ASS ファイルとして準備する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            name: 'subtitleIndex',
            in: 'path',
            required: true,
            schema: {
                type: 'integer',
            },
        },
    ],
    responses: {
        200: {
            description: '準備した字幕ファイルキー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/VideoPreparedSubtitle',
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
