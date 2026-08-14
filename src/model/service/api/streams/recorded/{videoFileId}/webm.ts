import { Operation } from 'express-openapi';
import IStreamApiModel, { StreamResponse } from '../../../../../api/stream/IStreamApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    let isClosed: boolean = false;
    let result: StreamResponse;
    let keepTimer: NodeJS.Timeout;
    let stopPromise: Promise<void> | null = null;

    const stop = async () => {
        clearInterval(keepTimer);

        if (typeof result === 'undefined') {
            return;
        }

        stopPromise ??= streamApiModel.stop(result.streamId, true);
        await stopPromise;
    };

    const close = () => {
        isClosed = true;
        void stop().catch(() => {});
    };
    req.once('aborted', close);
    res.once('close', close);

    try {
        result = await streamApiModel.startRecordedWebMStream({
            videoFileId: parseInt(req.params.videoFileId, 10),
            playPosition: parseInt(req.query.ss as string, 10),
            mode: parseInt(req.query.mode as string, 10),
            quality: typeof req.query.quality === 'string' ? req.query.quality : undefined,
            encoder: parseWatchEncoder(req.query.encoder),
            isHevc: req.query.hevc === '1' || req.query.hevc === 'true',
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

    res.setHeader('Content-Type', 'video/webm');
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

const parseWatchEncoder = (encoder: any): 'FFmpeg' | 'QSVEncC' | 'NVEncC' | 'VCEEncC' | undefined => {
    return encoder === 'FFmpeg' || encoder === 'QSVEncC' || encoder === 'NVEncC' || encoder === 'VCEEncC'
        ? encoder
        : undefined;
};

get.apiDoc = {
    summary: '録画 WebM ストリーム',
    tags: ['streams'],
    description: '録画 WebM ストリームを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            $ref: '#/components/parameters/StreamPlayPosition',
        },
        {
            $ref: '#/components/parameters/StreamMode',
        },
    ],
    responses: {
        200: {
            description: '録画 WebM ストリーム',
            content: {
                'video/webm': {},
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
