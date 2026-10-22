import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline, Readable } from 'stream';
import multer from 'multer';
import UploadAdmissionController, { IncomingUploadFile } from './UploadAdmissionController';

export interface UploadRequest extends Request {
    cleanupIncomingUpload?: () => Promise<void>;
}

/** Limit receivers before parsing, and keep partial-file ownership until all writers close. */
export function receiveUpload(
    req: UploadRequest,
    res: Response,
    next: NextFunction,
    options: {
        directory: string;
        timeout: number;
        admission: UploadAdmissionController;
        log: { error(message: string): void };
    },
): void {
    if (req.aborted || res.destroyed) return;
    const admission = options.admission.tryAcquire();
    if (admission === null) {
        res.status(503).json({ code: 503, message: 'UploadLimitReached' });
        req.resume();
        return;
    }
    const directory = path.join(options.directory, 'incoming', randomUUID());
    const payload = path.join(directory, 'payload');
    const incoming = new IncomingUploadFile(directory, payload, { error: error => options.log.error(String(error)) });
    let input: Readable | undefined;
    let output: fs.WriteStream | undefined;
    let terminal = false;
    const detach = (): void => {
        clearTimeout(timer);
        req.removeListener('aborted', onAborted);
        res.removeListener('close', onClosed);
        admission.releaseOnce();
    };
    const cleanup = async (): Promise<void> => {
        if (output !== undefined && !output.closed) {
            await new Promise<void>(resolve => output!.once('close', resolve));
        }
        await incoming.cleanupOnce();
    };
    const fail = (error: Error, status?: number): void => {
        if (terminal) return;
        terminal = true;
        detach();
        req.unpipe();
        input?.destroy(error);
        output?.destroy(error);
        req.resume();
        void cleanup().catch(failure => options.log.error(`upload cleanup failed: ${String(failure)}`));
        if (status !== undefined && !res.destroyed && !res.headersSent) {
            res.status(status).json({ code: status, message: error.message });
        } else if (!res.destroyed && !req.aborted) next(error);
    };
    const onAborted = (): void => fail(new Error('UploadAborted'));
    const onClosed = (): void => {
        if (!res.writableFinished) fail(new Error('UploadDisconnected'));
    };
    req.once('aborted', onAborted);
    res.once('close', onClosed);
    const timer = setTimeout(() => fail(new Error('UploadReceiveTimeout'), 408), options.timeout);
    const storage: multer.StorageEngine = {
        _handleFile: (_request, file, callback) => {
            if (terminal) {
                callback(new Error('UploadAborted'));
                return;
            }
            try {
                fs.mkdirSync(directory, { recursive: true });
                input = file.stream;
                output = fs.createWriteStream(payload, { flags: 'wx' });
                const writer = output;
                pipeline(file.stream, writer, error =>
                    callback(
                        error ?? null,
                        error
                            ? undefined
                            : {
                                  destination: directory,
                                  filename: 'payload',
                                  path: payload,
                                  size: writer.bytesWritten,
                              },
                    ),
                );
            } catch (error: any) {
                callback(error);
            }
        },
        _removeFile: (_request, _file, callback) => {
            void cleanup().then(
                () => callback(null),
                error => callback(error),
            );
        },
    };
    multer({ storage }).single('file')(req, res, error => {
        if (terminal) return;
        if (error) {
            fail(error);
            return;
        }
        terminal = true;
        detach();
        // The registration route now owns the received file; a disconnected response must
        // not remove it while the operator is moving/registering it.
        req.cleanupIncomingUpload = () => incoming.cleanupOnce();
        if (typeof req.body?.recordedId === 'string') req.body.recordedId = Number(req.body.recordedId);
        if (req.file !== undefined) req.body.file = req.file.filename;
        next();
    });
}
