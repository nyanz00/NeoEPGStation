import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../../../api/stream/IStreamApiModel';
import container from '../../../../../../ModelContainer';
import * as api from '../../../../../api';

const parseEncoder = (value: unknown) => {
    return value === 'FFmpeg' || value === 'QSVEncC' || value === 'NVEncC' || value === 'VCEEncC' ? value : undefined;
};

const parseBoolean = (value: unknown): boolean | undefined => {
    if (value === 'true' || value === '1') {
        return true;
    }
    if (value === 'false' || value === '0') {
        return false;
    }

    return undefined;
};

export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    try {
        if (typeof req.headers.host === 'undefined') {
            throw new Error('HostIsUndefined');
        }

        const playlist = await streamApiModel.getLiveM2TsStreamM3u8(req.headers.host, api.isSecureProtocol(req), {
            channelId: parseInt(req.params.channelId, 10),
            mode: parseInt(req.query.mode as string, 10),
            quality: typeof req.query.quality === 'string' ? req.query.quality : undefined,
            encoder: parseEncoder(req.query.encoder),
            isHevc: parseBoolean(req.query.hevc),
        });

        if (playlist === null) {
            api.responseError(res, {
                code: 404,
                message: 'play list is not found',
            });
        } else {
            api.responsePlayList(req, res, playlist);
        }
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ライブ M2TS ストリームプレイリスト',
    tags: ['streams'],
    description: 'ライブ M2TS ストリームプレイリストを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathChannelId',
        },
        {
            $ref: '#/components/parameters/StreamMode',
        },
        {
            $ref: '#/components/parameters/WatchStreamQuality',
        },
        {
            $ref: '#/components/parameters/WatchStreamEncoder',
        },
        {
            $ref: '#/components/parameters/WatchStreamHevc',
        },
    ],
    responses: {
        200: {
            description: 'ライブ M2TS ストリームプレイリストを取得しました',
            content: {
                'application/x-mpegURL': {},
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
