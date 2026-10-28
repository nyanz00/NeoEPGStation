import { Operation } from '../../../ApiOperation.js';
import IVideoAnalysisModel from '../../../../video/IVideoAnalysisModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

const operation =
    (force: boolean): Operation =>
    async (req, res) => {
        const model = container.get<IVideoAnalysisModel>('IVideoAnalysisModel');
        try {
            api.responseJSON(res, 200, await model.get(parseInt(req.params.videoFileId, 10), force));
        } catch (err: any) {
            api.responseServerError(res, err.message);
        }
    };

const apiDoc = {
    summary: '動画ファイルの解析情報',
    tags: ['videos'],
    parameters: [{ $ref: '#/components/parameters/PathVideoFileId' }],
    responses: {
        200: {
            description: '解析情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {
                            analysisVersion: { type: 'integer', description: '基本解析の形式バージョン' },
                            keyframes: {
                                type: 'object',
                                description: '部分解析による推定値。全キーフレーム一覧ではありません。',
                                properties: {
                                    status: {
                                        type: 'string',
                                        enum: ['pending', 'analyzing', 'ready', 'unavailable', 'error'],
                                    },
                                    version: { type: 'integer' },
                                    currentVersion: { type: 'integer' },
                                    estimated: { type: 'boolean', enum: [true] },
                                    stale: { type: 'boolean' },
                                    averageInterval: {
                                        type: 'number',
                                        nullable: true,
                                        description: 'サンプル内の平均間隔（秒）',
                                    },
                                    minInterval: { type: 'number', nullable: true },
                                    maxInterval: { type: 'number', nullable: true },
                                    intervalCount: { type: 'integer' },
                                    keyframeCount: { type: 'integer' },
                                    sampledDuration: { type: 'number', description: '解析区間の合計秒数' },
                                    sampleWindows: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                start: { type: 'number' },
                                                end: { type: 'number' },
                                                keyframeCount: { type: 'integer' },
                                            },
                                        },
                                    },
                                    analyzedAt: { type: 'number', nullable: true },
                                    error: { type: 'string', nullable: true },
                                },
                            },
                        },
                    },
                },
            },
        },
        default: {
            description: '予期しないエラー',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
    },
};

export const get: Operation = operation(false);
get.apiDoc = {
    ...apiDoc,
    description:
        '基本解析を取得。キーフレーム間隔は未解析・変更時にバックグラウンド解析を予約し、現在の状態と前回の結果を返す',
};
export const post: Operation = operation(true);
post.apiDoc = {
    ...apiDoc,
    description: '基本解析を更新し、キーフレーム間隔の再解析を予約する。完了までGETで状態を確認できる',
};
