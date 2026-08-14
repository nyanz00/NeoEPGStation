import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../../../api/stream/IStreamApiModel';
import container from '../../../../../../ModelContainer';
import * as api from '../../../../../api';

export const put: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');
    streamApiModel.keepRecordedVODHLSSession(req.params.sessionId);
    api.responseJSON(res, 200, { code: 200 });
};

export const del: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');
    streamApiModel.releaseRecordedVODHLSSession(req.params.sessionId);
    api.responseJSON(res, 200, { code: 200 });
};

const apiDoc = {
    tags: ['streams'],
    parameters: [
        {
            name: 'sessionId',
            in: 'path',
            required: true,
            schema: { type: 'string', maxLength: 128 },
        },
    ],
    responses: {
        200: {
            description: 'VOD HLS視聴セッションを更新しました',
        },
    },
};

put.apiDoc = {
    ...apiDoc,
    summary: 'VOD HLS視聴セッションを維持',
    description: 'VOD HLS視聴セッションの停止タイマーを更新する',
};

del.apiDoc = {
    ...apiDoc,
    summary: 'VOD HLS視聴セッションを解放',
    description: 'VOD HLS視聴セッションを解放する',
};
