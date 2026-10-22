import { Operation } from '../../ApiOperation';
import IIPTVApiModel from '../../../api/iptv/IIPTVApiModel';
import IConfiguration from '../../../IConfiguration';
import { completeIptvDocumentRequest, IPTV_DOCUMENT_TIMEOUT_MESSAGE } from '../../../api/iptv/IptvDocumentRequestGuard';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = (req, res) => {
    const configuration = container.get<IConfiguration>('IConfiguration');
    const timeoutMs = configuration.getConfig().iptvDocumentTimeout;

    return completeIptvDocumentRequest(res, {
        timeoutMs,
        execute: requestContext => {
            const iptvApiModel = container.get<IIPTVApiModel>('IIPTVApiModel');
            const days = typeof req.query.days === 'number' ? req.query.days : Number(req.query.days);
            return iptvApiModel.getEpg(days, req.query.isHalfWidth as any, requestContext);
        },
        failure: (error: any) => {
            if (error?.message === IPTV_DOCUMENT_TIMEOUT_MESSAGE) {
                res.status(504).json({ code: 504, message: 'Gateway Timeout' });
            } else {
                api.responseServerError(res, error?.message);
            }
        },
        success: result => {
            res.setHeader('Content-Type', 'application/xml; charset="UTF-8"');
            res.status(200);
            res.end(result);
        },
    });
};

get.apiDoc = {
    summary: 'IPTV epg を取得',
    tags: ['iptv'],
    description: 'IPTV epg を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/IPTVIsHalfWidth',
        },
        {
            $ref: '#/components/parameters/IPTVDays',
        },
    ],
    responses: {
        200: {
            description: 'epg を取得しました',
            content: {
                'application/xml': {},
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
