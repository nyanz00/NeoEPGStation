import { Operation } from '../../ApiOperation.js';
import IIPTVApiModel from '../../../api/iptv/IIPTVApiModel.js';
import IConfiguration from '../../../IConfiguration.js';
import {
    completeIptvDocumentRequest,
    IPTV_DOCUMENT_TIMEOUT_MESSAGE,
} from '../../../api/iptv/IptvDocumentRequestGuard.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

export const get: Operation = (req, res) => {
    const configuration = container.get<IConfiguration>('IConfiguration');
    const config = configuration.getConfig();

    return completeIptvDocumentRequest(res, {
        timeoutMs: config.iptvDocumentTimeout,
        execute: requestContext => {
            if (typeof req.headers.host === 'undefined') {
                throw new Error('HostIsUndefined');
            }

            const iptvApiModel = container.get<IIPTVApiModel>('IIPTVApiModel');
            return iptvApiModel.getChannelList(
                req.headers.host,
                api.isSecureProtocol(req),
                typeof req.query.mode === 'number' ? req.query.mode : Number(req.query.mode),
                req.query.isHalfWidth as any,
                config.subDirectory,
                requestContext,
            );
        },
        failure: (error: any) => {
            if (error?.message === IPTV_DOCUMENT_TIMEOUT_MESSAGE) {
                res.status(504).json({ code: 504, message: 'Gateway Timeout' });
            } else {
                api.responseServerError(res, error?.message);
            }
        },
        success: result => {
            res.setHeader('Content-Type', 'application/x-mpegURL; charset="UTF-8"');
            res.status(200);
            res.end(result);
        },
    });
};

get.apiDoc = {
    summary: 'IPTV channel list を取得',
    tags: ['iptv'],
    description: 'IPTV channel list を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/IPTVIsHalfWidth',
        },
        {
            $ref: '#/components/parameters/StreamMode',
        },
    ],
    responses: {
        200: {
            description: 'channel list を取得しました',
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
