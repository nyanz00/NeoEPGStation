import { Operation } from '../../../../../ApiOperation';
import IStreamApiModel from '../../../../../../api/stream/IStreamApiModel';
import container from '../../../../../../ModelContainer';
import * as api from '../../../../../api';

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

    try {
        const playlist = await streamApiModel.getRecordedVODHLSPlaylist(
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
            parseOptionalInteger(req.query.startupBufferSegments),
        );

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.status(200).send(playlist);
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画 VOD HLS プレイリスト',
    tags: ['streams'],
    description: '録画ファイルを VOD HLS として再生するためのプレイリストを取得する',
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
        {
            name: 'vodSessionId',
            in: 'query',
            required: false,
            description: 'VOD HLS視聴クライアント識別子',
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
            description: '焼き込み字幕の文字サイズ（元字幕に対する割合）',
            schema: { type: 'integer', minimum: 50, maximum: 250, default: 100 },
        },
        {
            name: 'subtitleOpacity',
            in: 'query',
            required: false,
            description: '焼き込み字幕の文字不透明度（元字幕に対する割合）',
            schema: { type: 'integer', minimum: 10, maximum: 300, default: 100 },
        },
        {
            name: 'subtitleOutlineSize',
            in: 'query',
            required: false,
            description: '焼き込み字幕の縁取り幅（元字幕に対する割合）',
            schema: { type: 'integer', minimum: 0, maximum: 300, default: 100 },
        },
        {
            name: 'subtitleOutlineOpacity',
            in: 'query',
            required: false,
            description: '焼き込み字幕の縁取り不透明度（元字幕に対する割合）',
            schema: { type: 'integer', minimum: 0, maximum: 300, default: 100 },
        },
        {
            name: 'startupBufferSegments',
            in: 'query',
            required: false,
            description: '再生開始前に生成を待つ先頭セグメント数',
            schema: {
                type: 'integer',
                minimum: 1,
                maximum: 3,
                default: 1,
            },
        },
    ],
    responses: {
        200: {
            description: '録画 VOD HLS プレイリスト',
            content: {
                'application/vnd.apple.mpegurl': {},
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
