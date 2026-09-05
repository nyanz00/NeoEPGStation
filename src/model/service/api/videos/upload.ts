import * as fs from 'fs';
import * as path from 'path';
import * as apid from '../../../../../api';
import { Operation } from '../../ApiOperation';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import IChannelDB from '../../../db/IChannelDB';
import container from '../../../ModelContainer';
import { UploadedVideoFileOption } from '../../../operator/recorded/IRecordedManageModel';
import ITsInfoAnalyzer, { TsInfo } from '../../../recorded/ts/ITsInfoAnalyzer';
import * as api from '../../api';

const decodeUploadFileName = (fileName: string): string => {
    const decoded = Buffer.from(fileName, 'latin1').toString('utf8');
    if (decoded.includes('\uFFFD')) {
        return fileName;
    }

    const mojibakeLike = /[ÃÂãåæçèéêëìíîïðñòóôõöùúûüýÿ\u0080-\u009f]/.test(fileName);
    if (mojibakeLike === false) {
        return fileName;
    }

    const countJapanese = (value: string): number => {
        return (value.match(/[\u3040-\u30ff\u3400-\u9fff]/g) ?? []).length;
    };

    return countJapanese(decoded) >= countJapanese(fileName) ? decoded : fileName;
};

const optionalNumber = (value: unknown): number | undefined => {
    // Multipart middleware may already have converted numeric fields.
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string' || value.trim().length === 0) return undefined;
    const result = Number(value);
    return Number.isFinite(result) ? result : undefined;
};

const optionalText = (value: unknown): string | undefined => {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

const analyzeUploadedM2ts = async (filePath: string, expectedServiceId?: number): Promise<TsInfo> => {
    const analyzer = container.get<ITsInfoAnalyzer>('ITsInfoAnalyzer');
    return await analyzer.analyze(filePath, {
        includeEit: true,
        maxReadBytes: 64 * 1024 * 1024,
        timeoutMs: 15000,
        ...(expectedServiceId === undefined ? {} : { expectedServiceId }),
    });
};

const createRecordedFromM2ts = async (
    body: Record<string, unknown>,
    filePath: string,
    recordedApiModel: IRecordedApiModel,
): Promise<apid.RecordedId> => {
    const channelDB = container.get<IChannelDB>('IChannelDB');
    const specifiedChannelId = optionalNumber(body.channelId);
    const specifiedChannel = specifiedChannelId === undefined ? undefined : await channelDB.findId(specifiedChannelId);
    if (specifiedChannelId !== undefined && specifiedChannel === null) throw new Error('ChannelIdIsNull');

    const info = await analyzeUploadedM2ts(filePath, specifiedChannel?.serviceId);
    const channel =
        specifiedChannel ??
        (await channelDB.findAll()).find(
            item => item.networkId === info.networkId && item.serviceId === info.serviceId,
        );
    const startAt = optionalNumber(body.startAt) ?? info.eventStartAt ?? undefined;
    const duration =
        optionalNumber(body.duration) ??
        (info.eventDuration !== null && info.eventDuration > 0 ? info.eventDuration * 1000 : undefined);
    const name = optionalText(body.name) ?? optionalText(info.eventName) ?? undefined;

    const missing: string[] = [];
    if (channel === undefined || channel === null) missing.push('放送局');
    if (startAt === undefined) missing.push('開始日時');
    if (duration === undefined || duration <= 0) missing.push('長さ');
    if (name === undefined) missing.push('番組名');
    if (
        channel === undefined ||
        channel === null ||
        startAt === undefined ||
        duration === undefined ||
        duration <= 0 ||
        name === undefined
    ) {
        throw new Error(`M2tsEitMetadataIsNotFound:${missing.join('、')}`);
    }

    const option: apid.CreateNewRecordedOption = {
        userId: optionalNumber(body.userId),
        channelId: channel.id,
        startAt,
        endAt: startAt + duration,
        name,
        description: optionalText(body.description) ?? optionalText(info.eventDescription),
        extended: optionalText(body.extended) ?? optionalText(info.eventExtended),
    };
    const genres = info.genres.slice(0, 3);
    if (genres[0] !== undefined) {
        option.genre1 = genres[0].lv1;
        option.subGenre1 = genres[0].lv2;
    }
    if (genres[1] !== undefined) {
        option.genre2 = genres[1].lv1;
        option.subGenre2 = genres[1].lv2;
    }
    if (genres[2] !== undefined) {
        option.genre3 = genres[2].lv1;
        option.subGenre3 = genres[2].lv2;
    }
    return await recordedApiModel.createNewRecorded(option);
};

export const post: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    let createdRecordedId: apid.RecordedId | undefined;

    try {
        if (typeof req.file === 'undefined') {
            throw new Error('FileIsNotFound');
        }

        const fileName = decodeUploadFileName(req.file.originalname);
        const requestedRecordedId = optionalNumber(req.body.recordedId);
        if (requestedRecordedId === undefined) {
            if (path.extname(fileName).toLowerCase() !== '.m2ts') throw new Error('RecordedIdIsRequired');
            createdRecordedId = await createRecordedFromM2ts(req.body, req.file.path, recordedApiModel);
        }
        const recordedId = requestedRecordedId ?? createdRecordedId;
        if (recordedId === undefined) throw new Error('RecordedIdIsRequired');

        const option: UploadedVideoFileOption = {
            recordedId,
            parentDirectoryName: req.body.parentDirectoryName,
            viewName: req.body.viewName,
            fileType: req.body.fileType,
            fileName,
            filePath: req.file.path,
        };
        if (typeof req.body.subDirectory !== 'undefined') {
            option.subDirectory = req.body.subDirectory;
        }

        await recordedApiModel.addUploadedVideoFile(option);

        api.responseJSON(res, 200, { recordedId });
    } catch (err: any) {
        if (createdRecordedId !== undefined) await recordedApiModel.delete(createdRecordedId).catch(() => undefined);
        if (req.file !== undefined) await fs.promises.unlink(req.file.path).catch(() => undefined);
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'アップロードしたビデオファイルを追加',
    tags: ['videos'],
    description: 'アップロードしたビデオファイルを追加する',
    requestBody: {
        content: {
            'multipart/form-data': {
                schema: {
                    $ref: '#/components/schemas/UploadVideoFileOption',
                },
            },
        },
    },
    responses: {
        200: {
            description: 'アップロードしたビデオファイルを追加しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/CreatedNewRecorded',
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
