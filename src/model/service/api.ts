import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import IPlayList from '../api/IPlayList';

export interface IError {
    readonly code: number;
    readonly message: string;
    errors?: string;
}

export const responseError = (res: express.Response, reason: IError): express.Response => {
    const error: IError = {
        code: reason.code,
        message: reason.message,
    };

    res.status(reason.code);
    res.json(error);

    return res;
};

export const responseServerError = (res: express.Response, err?: string): express.Response => {
    if (err === 'RecordedResourceBusy' || err === 'RecordedResourceDeleting') {
        return res.status(409).json({ code: 409, message: err });
    }
    if (err === 'InvalidSubDirectory' || err === 'ReservationNotEditable') {
        const code = err === 'InvalidSubDirectory' ? 400 : 409;
        return res.status(code).json({ code, message: err, errors: err });
    }
    const error: IError = {
        code: 500,
        message: 'Internal Server Error',
    };

    if (typeof err !== 'undefined') {
        error.errors = err;
    }

    res.status(error.code);
    res.json(error);

    return res;
};

export const responseJSON = (res: express.Response, code: number, body?: any): express.Response => {
    res.status(code);
    // non-cache
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    res.json(body);

    return res;
};

/**
 * PlayList を m3u8 としてレスポンスする
 */
export const responsePlayList = (req: express.Request, res: express.Response, list: IPlayList): void => {
    res.setHeader('Content-Type', 'application/x-mpegURL; charset="UTF-8"');
    const disposition = /firefox|Firefox/.test(<string>req.headers['user-agent']) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${list.name};`);
    res.status(200);
    res.write(list.playList);
    res.end();
};

export interface FileResponseHandle {
    closed: Promise<void>;
    stop(): Promise<void>;
}

export const responseFile = (
    req: express.Request,
    res: express.Response,
    filePath: string,
    mime: string,
    download = false,
): FileResponseHandle => {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        throw new Error('file path is derectory');
    }

    const responseHeaders: Record<string, string | number> = {};
    if (download) {
        responseHeaders['Content-Type'] = 'application/octet-stream';
        responseHeaders['Content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(
            path.basename(filePath),
        )};`;
    } else {
        responseHeaders['Content-Type'] = mime;
    }

    const rangeRequest = readRangeHeader(req.headers['range'], stat.size);

    if (rangeRequest === null) {
        responseHeaders['Content-Length'] = stat.size;
        responseHeaders['Accept-Ranges'] = 'bytes';
        return sendResponse(200, res, responseHeaders, req.method === 'HEAD' ? null : fs.createReadStream(filePath));
    }
    if (rangeRequest === false) {
        responseHeaders['Content-Range'] = `bytes */${stat.size.toString(10)}`;
        responseHeaders['Content-Length'] = 0;
        responseHeaders['Accept-Ranges'] = 'bytes';
        return sendResponse(416, res, responseHeaders, null);
    }

    const start: number = rangeRequest.start;
    const end: number = rangeRequest.end;

    responseHeaders['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    responseHeaders['Content-Length'] = end - start + 1;
    responseHeaders['Accept-Ranges'] = 'bytes';

    const option = { start: start, end: end };
    const stream = req.method === 'HEAD' ? null : fs.createReadStream(filePath, option);
    return sendResponse(206, res, responseHeaders, stream);
};

const readRangeHeader = (
    range: string | string[] | undefined | null,
    totalLength: number,
): { start: number; end: number } | null | false => {
    if (typeof range !== 'string' || range === null || range.length === 0) {
        return null;
    }
    if (totalLength <= 0) {
        return false;
    }

    const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
    if (match === null || (match[1].length === 0 && match[2].length === 0)) {
        return false;
    }

    if (match[1].length === 0) {
        const suffixLength = Number(match[2]);
        if (Number.isSafeInteger(suffixLength) === false || suffixLength <= 0) {
            return false;
        }

        return {
            start: Math.max(totalLength - suffixLength, 0),
            end: totalLength - 1,
        };
    }

    const start = Number(match[1]);
    const requestedEnd = match[2].length === 0 ? totalLength - 1 : Number(match[2]);
    if (
        Number.isSafeInteger(start) === false ||
        Number.isSafeInteger(requestedEnd) === false ||
        start < 0 ||
        start >= totalLength ||
        requestedEnd < start
    ) {
        return false;
    }

    return {
        start,
        end: Math.min(requestedEnd, totalLength - 1),
    };
};

const sendResponse = (
    code: number,
    res: express.Response,
    responseHeaders: Record<string, string | number>,
    readable: fs.ReadStream | null,
): FileResponseHandle => {
    res.status(code);
    res.set(responseHeaders);

    if (readable === null) {
        res.end();
        return { closed: Promise.resolve(), stop: () => Promise.resolve() };
    } else {
        let resolveClosed!: () => void;
        let didClose = false;
        const closed = new Promise<void>(resolve => {
            resolveClosed = resolve;
        });
        readable.once('close', () => {
            didClose = true;
            resolveClosed();
        });
        const stop = (): Promise<void> => {
            if (!didClose) readable.destroy();
            return closed;
        };

        readable.once('error', error => {
            if (!res.destroyed) res.destroy(error);
        });
        readable.once('open', () => {
            if (res.destroyed) {
                void stop();
                return;
            }
            readable.pipe(res);
        });

        readable.once('end', () => {
            readable.close(); // ファイルを開放する
        });

        // 接続切断時もファイルを開放し、file leaseはclose後まで保持する
        res.once('close', () => {
            void stop();
        });

        return { closed, stop };
    }
};

export const isSecureProtocol = (req: express.Request): boolean => {
    return (
        req.header('x-forwarded-proto') === 'https' ||
        req.header('X-Forwarded-Proto') === 'https' ||
        req.protocol === 'https'
    );
};
