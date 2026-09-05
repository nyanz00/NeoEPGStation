import { Operation } from '../../../../../../ApiOperation';
import IStreamApiModel, { SegmentStreamResponse } from '../../../../../../../api/stream/IStreamApiModel';
import container from '../../../../../../../ModelContainer';
import * as api from '../../../../../../api';

const parseWatchEncoder = (encoder: any): 'FFmpeg' | 'QSVEncC' | 'NVEncC' | 'VCEEncC' | undefined => {
    return encoder === 'FFmpeg' || encoder === 'QSVEncC' || encoder === 'NVEncC' || encoder === 'VCEEncC'
        ? encoder
        : undefined;
};

const parseBoolean = (value: unknown): boolean | undefined => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (value === 'true' || value === '1') {
        return true;
    }
    if (value === 'false' || value === '0') {
        return false;
    }

    return undefined;
};

const parseOptionalInteger = (value: unknown): number | undefined => {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) ? value : undefined;
    }
    if (typeof value !== 'string' || value.length === 0) {
        return undefined;
    }

    const parsed = Number(value);

    return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const parsePercent = (value: unknown, minimum: number, maximum: number): number | undefined => {
    const parsed = parseOptionalInteger(value);
    return typeof parsed === 'number' && parsed >= minimum && parsed <= maximum ? parsed : undefined;
};

export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    let isClosed: boolean = false;
    let result: SegmentStreamResponse | null = null;

    const stop = async () => {
        if (result === null) {
            return;
        }

        await result.cleanup();
    };

    req.on('close', async () => {
        isClosed = true;
        await stop();
    });

    try {
        result = await streamApiModel.createRecordedVODHLSSegmentStream(
            {
                videoFileId: parseInt(req.params.videoFileId, 10),
                playPosition: parseFloat(req.query.ss as string),
                mode: parseInt(req.query.mode as string, 10),
                vodSessionId: typeof req.query.vodSessionId === 'string' ? req.query.vodSessionId : undefined,
                quality: typeof req.query.quality === 'string' ? req.query.quality : undefined,
                encoder: parseWatchEncoder(req.query.encoder),
                isHevc: parseBoolean(req.query.hevc),
                subtitleIndex: parseOptionalInteger(req.query.subtitleIndex),
                subtitleFileKey: typeof req.query.subtitleFileKey === 'string' ? req.query.subtitleFileKey : undefined,
                subtitleSize: parsePercent(req.query.subtitleSize, 50, 250),
                subtitleOpacity: parsePercent(req.query.subtitleOpacity, 10, 300),
                subtitleOutlineSize: parsePercent(req.query.subtitleOutlineSize, 0, 300),
                subtitleOutlineOpacity: parsePercent(req.query.subtitleOutlineOpacity, 0, 300),
            },
            parseInt(req.params.sequence, 10),
        );
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
    summary: '録画 VOD HLS セグメント',
    tags: ['streams'],
    description: '録画ファイルを VOD HLS として再生するためのセグメントを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            name: 'sequence',
            in: 'path',
            required: true,
            schema: {
                type: 'integer',
            },
        },
        {
            $ref: '#/components/parameters/StreamPlayPosition',
        },
        {
            $ref: '#/components/parameters/StreamMode',
        },
        {
            name: 'vodSessionId',
            in: 'query',
            required: false,
            schema: { type: 'string', maxLength: 128 },
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
        {
            name: 'subtitleIndex',
            in: 'query',
            required: false,
            schema: {
                type: 'integer',
            },
        },
        {
            name: 'subtitleSize',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 50, maximum: 250, default: 100 },
        },
        {
            name: 'subtitleOpacity',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 10, maximum: 300, default: 100 },
        },
        {
            name: 'subtitleOutlineSize',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 0, maximum: 300, default: 100 },
        },
        {
            name: 'subtitleOutlineOpacity',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 0, maximum: 300, default: 100 },
        },
    ],
    responses: {
        200: {
            description: '録画 VOD HLS セグメント',
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
