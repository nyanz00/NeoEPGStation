import express from 'express';
import container from '../ModelContainer';
import IVideoFileDB from '../db/IVideoFileDB';
import { recordedUseClient } from '../RecordedUseClient';
import IVideoApiModel, { VideoFilePathInfo } from '../api/video/IVideoApiModel';
import * as api from './api';

type ResolveVideoPath = (videoFileId: number) => Promise<VideoFilePathInfo | null>;

/** Serve a recorded video while its source is protected by a recorded-use lease. */
export const responseRecordedVideo = async (
    req: express.Request,
    res: express.Response,
    videoFileId: number,
    resolvePath: ResolveVideoPath,
    download = false,
): Promise<void> => {
    const videoFileDB = container.get<IVideoFileDB>('IVideoFileDB');
    const videoFile = await videoFileDB.findId(videoFileId);
    if (videoFile === null) {
        api.responseError(res, { code: 404, message: 'video file is not found' });
        return;
    }

    let cancelled = false;
    let handle: ReturnType<typeof api.responseFile> | null = null;
    const currentHandle = (): ReturnType<typeof api.responseFile> | null => handle;
    let setupPromise: Promise<ReturnType<typeof api.responseFile> | null> = Promise.resolve(null);
    let completeSetup!: () => void;
    const setupFinished = new Promise<void>(resolve => (completeSetup = resolve));
    const onResponseClose = (): void => {
        if (handle === null) cancelled = true;
    };
    res.once('close', onResponseClose);

    let lease: Awaited<ReturnType<typeof recordedUseClient.acquire>>;
    try {
        lease = await recordedUseClient.acquire(
            { recordedId: videoFile.recordedId, videoFileId, purpose: 'play' },
            async () => {
                cancelled = true;
                if (!res.destroyed) res.destroy();
                await setupFinished;
                await currentHandle()?.stop();
            },
        );
    } catch (error) {
        res.removeListener('close', onResponseClose);
        throw error;
    }

    try {
        setupPromise = (async () => {
            try {
                if (cancelled) {
                    await lease.release();
                    return null;
                }
                const fileInfo = await resolvePath(videoFileId);
                if (fileInfo === null) {
                    if (!cancelled) api.responseError(res, { code: 404, message: 'video file is not found' });
                    await lease.release();
                    return null;
                }
                if (cancelled) {
                    await lease.release();
                    return null;
                }

                handle = api.responseFile(req, res, fileInfo.path, fileInfo.mime, download);
                res.removeListener('close', onResponseClose);
                return handle;
            } finally {
                completeSetup();
            }
        })();

        const responseHandle = await setupPromise;
        if (responseHandle === null) return;
        await responseHandle.closed;
        await lease.release();
    } catch (error) {
        await currentHandle()?.stop();
        await lease.release();
        throw error;
    } finally {
        res.removeListener('close', onResponseClose);
    }
};

export const resolveFullVideoPath =
    (videoApiModel: IVideoApiModel): ResolveVideoPath =>
    videoFileId =>
        videoApiModel.getFullFilePath(videoFileId);

export const resolveWebVideoPath =
    (videoApiModel: IVideoApiModel): ResolveVideoPath =>
    videoFileId =>
        videoApiModel.getWebPlaybackFilePath(videoFileId);
