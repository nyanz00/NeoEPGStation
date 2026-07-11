import { Operation } from 'express-openapi';
import IStreamApiModel, { StreamResponse } from '../../../../../api/stream/IStreamApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

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

    let isClosed: boolean = false;
    let result: StreamResponse;
    let keepTimer: NodeJS.Timer;

    const stop = async () => {
        clearInterval(keepTimer);

        if (typeof result === 'undefined') {
            return;
        }

        await streamApiModel.stop(result.streamId, true);
    };

    req.on('close', async () => {
        isClosed = true;
        await stop();
    });

    try {
        result = await streamApiModel.startLiveM2TsLLStream({
            channelId: parseInt(req.params.channelId, 10),
            mode: parseInt(req.query.mode as string, 10),
            quality: typeof req.query.quality === 'string' ? req.query.quality : undefined,
            encoder: parseEncoder(req.query.encoder),
            isHevc: parseBoolean(req.query.hevc),
        });
        keepTimer = setInterval(() => {
            streamApiModel.keep(result.streamId);
        }, 10 * 1000);
    } catch (err: any) {
        api.responseServerError(res, err.message);

        return;
    }

    if (isClosed !== false) {
        await stop();

        return;
    }

    res.setHeader('Content-Type', 'video/mp2t');
    res.status(200);

    result.stream.on('close', () => {
        res.end();
    });
    result.stream.on('exit', () => {
        res.end();
    });
    result.stream.on('error', () => {
        res.end();
    });

    result.stream.pipe(res);
};

get.apiDoc = {
    summary: 'ライブ M2TS Low Latency (mpegts.js 用) ストリーム',
    tags: ['streams'],
    description: 'ライブ M2TS Low Latency ストリームを取得する',
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
            description: 'ライブ M2TS Low Latency ストリーム',
            content: {
                'video/mp2t': {},
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
