const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const { after, before, test } = require('node:test');
const express = require('express');
const openapi = require('express-openapi');
const yaml = require('js-yaml');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '../..');
const modelPath = path.join(repoRoot, 'src/model/api/video/VideoCommentApiModel.ts');
const parserPath = path.join(repoRoot, 'src/util/AssCommentParser.ts');
const routePath = path.join(repoRoot, 'src/model/service/api/videos/{videoFileId}/comments.ts');
const apiDocument = yaml.load(fs.readFileSync(path.join(repoRoot, 'api.yml'), 'utf8'));

function loadTypeScript(sourcePath, mocks = {}) {
    const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
        compilerOptions: {
            experimentalDecorators: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
    }).outputText;
    const loaded = new Module(sourcePath, module);
    loaded.filename = sourcePath;
    loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === sourcePath && Object.hasOwn(mocks, request)) return mocks[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loaded._compile(compiled, sourcePath);
    } finally {
        Module._load = originalLoad;
    }
    return loaded.exports;
}

const assParser = loadTypeScript(parserPath);
const { default: VideoCommentApiModel, VideoCommentRequestError } = loadTypeScript(modelPath, {
    inversify: {
        inject: () => () => {},
        injectable: () => target => target,
    },
    '../../../util/AssCommentParser': assParser,
});

const recordedComments = {
    isSuccess: true,
    comments: [
        {
            id: 0,
            time: 12.25,
            text: 'broadcast comment',
            color: '#00FFFF',
            position: 'right',
            size: 'medium',
            userId: 'viewer-1',
            postedAt: 0,
        },
    ],
    detail: 'recorded comments',
};

const assText = String.raw`[Script Info]
Title: comments

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,Arial,40,&H0000FF00,&H000000FF,&H00000000,&H00000000,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.00,0:00:06.00,Main,late,0,0,0,,late {\1c&H000000FF&\an8\fs48}red
Dialogue: 0,0:00:02.50,0:00:03.50,Main,early,0,0,0,,early {\an2\fs20}green`;

function createModelFixture({
    videoFile = null,
    subtitleItems = [{ subtitleIndex: 4 }],
    subtitleText = assText,
    jikkyoResult = recordedComments,
    extractError = null,
} = {}) {
    const calls = { findId: [], jikkyo: [], subtitles: [], subtitleText: [] };
    const videoFileDB = {
        findId: async id => {
            calls.findId.push(id);
            return videoFile;
        },
    };
    const videoApi = {
        getSubtitles: async id => {
            calls.subtitles.push(id);
            return { items: subtitleItems };
        },
        getSubtitleText: async (id, subtitleIndex) => {
            calls.subtitleText.push({ id, subtitleIndex });
            if (extractError !== null) throw extractError;
            return { subtitleText };
        },
    };
    const jikkyoApi = {
        getRecordedComments: async (recordedId, videoFileId) => {
            calls.jikkyo.push({ recordedId, videoFileId });
            return jikkyoResult;
        },
    };
    return { model: new VideoCommentApiModel(videoFileDB, videoApi, jikkyoApi), calls };
}

function assertNormalizedCommentSchema(comments) {
    const fields = ['color', 'id', 'position', 'postedAt', 'size', 'text', 'time', 'userId'].sort();
    assert.ok(comments.length > 0);
    for (const comment of comments) assert.deepEqual(Object.keys(comment).sort(), fields);
}

test('TS comments use recorded jikkyo and add the common video time base', async () => {
    const { model, calls } = createModelFixture({ videoFile: { type: 'ts', recordedId: 42 } });

    const result = await model.getComments(23);

    assert.deepEqual(result, { ...recordedComments, source: 'jikkyo', timeBase: 'video' });
    assert.deepEqual(calls.findId, [23]);
    assert.deepEqual(calls.jikkyo, [{ recordedId: 42, videoFileId: 23 }]);
    assert.deepEqual(calls.subtitles, []);
    assert.deepEqual(calls.subtitleText, []);
});

test('encoded comments parse real ASS into the same comment schema and sort by video time', async () => {
    const { model, calls } = createModelFixture({ videoFile: { type: 'encoded', recordedId: 42 } });

    const result = await model.getComments(23, 4);

    assert.equal(result.source, 'ass');
    assert.equal(result.timeBase, 'video');
    assert.equal(result.subtitleIndex, 4);
    assert.equal(result.isSuccess, true);
    assert.deepEqual(
        result.comments.map(comment => comment.time),
        [2.5, 5],
    );
    assert.deepEqual(
        result.comments.map(comment => comment.color),
        ['#00FF00', '#FF0000'],
    );
    assert.deepEqual(
        result.comments.map(comment => comment.position),
        ['bottom', 'top'],
    );
    assert.deepEqual(
        result.comments.map(comment => comment.size),
        ['small', 'big'],
    );
    assert.deepEqual(
        result.comments.map(comment => comment.text),
        ['early green', 'late red'],
    );
    assertNormalizedCommentSchema(recordedComments.comments);
    assertNormalizedCommentSchema(result.comments);
    assert.deepEqual(calls.subtitles, [23]);
    assert.deepEqual(calls.subtitleText, [{ id: 23, subtitleIndex: 4 }]);
    assert.deepEqual(calls.jikkyo, []);
});

test('an encoded subtitle with no comments returns an empty unsuccessful result', async () => {
    const { model } = createModelFixture({
        videoFile: { type: 'encoded', recordedId: 42 },
        subtitleText: '',
    });

    const result = await model.getComments(23, 4);

    assert.equal(result.isSuccess, false);
    assert.deepEqual(result.comments, []);
    assert.equal(result.source, 'ass');
    assert.equal(result.timeBase, 'video');
    assert.equal(result.subtitleIndex, 4);
});

test('invalid video file IDs are rejected before database lookup', async () => {
    for (const videoFileId of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        const { model, calls } = createModelFixture({ videoFile: { type: 'ts', recordedId: 42 } });
        await assert.rejects(
            model.getComments(videoFileId),
            error => error instanceof VideoCommentRequestError && error.code === 400,
        );
        assert.deepEqual(calls.findId, []);
        assert.deepEqual(calls.jikkyo, []);
    }
});

test('missing files and invalid file/index combinations fail before external lookup or extraction', async () => {
    const missing = createModelFixture();
    await assert.rejects(
        missing.model.getComments(23),
        error => error instanceof VideoCommentRequestError && error.code === 404,
    );
    assert.deepEqual(missing.calls.jikkyo, []);
    assert.deepEqual(missing.calls.subtitles, []);
    assert.deepEqual(missing.calls.subtitleText, []);

    const tsWithSubtitle = createModelFixture({ videoFile: { type: 'ts', recordedId: 42 } });
    await assert.rejects(
        tsWithSubtitle.model.getComments(23, 4),
        error => error instanceof VideoCommentRequestError && error.code === 400,
    );
    assert.deepEqual(tsWithSubtitle.calls.jikkyo, []);
    assert.deepEqual(tsWithSubtitle.calls.subtitles, []);

    for (const subtitleIndex of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        const invalid = createModelFixture({ videoFile: { type: 'encoded', recordedId: 42 } });
        await assert.rejects(
            invalid.model.getComments(23, subtitleIndex),
            error => error instanceof VideoCommentRequestError && error.code === 400,
        );
        assert.deepEqual(invalid.calls.subtitles, []);
        assert.deepEqual(invalid.calls.subtitleText, []);
        assert.deepEqual(invalid.calls.jikkyo, []);
    }

    const unknownTrack = createModelFixture({ videoFile: { type: 'encoded', recordedId: 42 } });
    await assert.rejects(
        unknownTrack.model.getComments(23, 6),
        error => error instanceof VideoCommentRequestError && error.code === 400,
    );
    assert.deepEqual(unknownTrack.calls.subtitles, [23]);
    assert.deepEqual(unknownTrack.calls.subtitleText, []);
    assert.deepEqual(unknownTrack.calls.jikkyo, []);
});

test('subtitle extraction failures propagate as server errors', async () => {
    const extractionError = new Error('subtitle extraction failed');
    const { model, calls } = createModelFixture({
        videoFile: { type: 'encoded', recordedId: 42 },
        extractError: extractionError,
    });

    await assert.rejects(model.getComments(23, 4), error => error === extractionError);
    assert.deepEqual(calls.subtitleText, [{ id: 23, subtitleIndex: 4 }]);
    assert.deepEqual(calls.jikkyo, []);
});

const routeCalls = [];
let routeResult = { ...recordedComments, source: 'jikkyo', timeBase: 'video' };
let routeError = null;
const routeModel = {
    getComments: async (videoFileId, subtitleIndex) => {
        routeCalls.push({ videoFileId, subtitleIndex });
        if (routeError !== null) throw routeError;
        if (subtitleIndex !== undefined && (!Number.isSafeInteger(subtitleIndex) || subtitleIndex < 0)) {
            throw new VideoCommentRequestError(400, 'Invalid subtitleIndex');
        }
        return routeResult;
    },
};
const routeModule = loadTypeScript(routePath, {
    '../../../../api/video/VideoCommentApiModel': { VideoCommentRequestError },
    '../../../../ModelContainer': {
        default: {
            get: key => {
                assert.equal(key, 'IVideoCommentApiModel');
                return routeModel;
            },
        },
    },
    '../../../api': {
        responseJSON: (res, code, body) => res.status(code).json(body),
        responseError: (res, reason) => res.status(reason.code).json(reason),
        responseServerError: (res, message) => res.status(500).json({ code: 500, message }),
    },
});
const routeApp = express();
routeApp.set('query parser', 'extended');
routeApp.use((req, _res, next) => {
    Object.defineProperty(req, 'query', {
        value: req.query,
        writable: true,
        configurable: true,
        enumerable: true,
    });
    next();
});
apiDocument.servers = [{ url: '/api' }];
const routeApiReady = openapi.initialize({
    apiDoc: apiDocument,
    app: routeApp,
    docsPath: '/docs',
    paths: [{ path: '/videos/{videoFileId}/comments', module: routeModule }],
    errorMiddleware: (error, _req, res, _next) => res.status(400).json(error),
});
let server;
let baseUrl;

before(async () => {
    await routeApiReady;
    server = http.createServer(routeApp);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => new Promise(resolve => server.close(resolve)));

test('comments route maps request and unexpected failures to their HTTP statuses', async () => {
    const success = await fetch(`${baseUrl}/videos/23/comments`);
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), routeResult);
    assert.deepEqual(routeCalls.at(-1), { videoFileId: 23, subtitleIndex: undefined });

    routeResult = {
        isSuccess: false,
        comments: [],
        detail: 'no comments',
        source: 'jikkyo',
        timeBase: 'video',
    };
    const noData = await fetch(`${baseUrl}/videos/23/comments`);
    assert.equal(noData.status, 200);
    assert.deepEqual(await noData.json(), routeResult);
    routeResult = { ...recordedComments, source: 'jikkyo', timeBase: 'video' };

    routeError = new VideoCommentRequestError(400, 'invalid subtitle selection');
    const badRequest = await fetch(`${baseUrl}/videos/23/comments`);
    assert.equal(badRequest.status, 400);
    assert.deepEqual(await badRequest.json(), { code: 400, message: 'invalid subtitle selection' });

    routeError = new VideoCommentRequestError(404, 'missing video');
    const missing = await fetch(`${baseUrl}/videos/23/comments`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { code: 404, message: 'missing video' });

    routeError = new Error('unexpected extraction failure');
    const failure = await fetch(`${baseUrl}/videos/23/comments`);
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { code: 500, message: 'unexpected extraction failure' });
    routeError = null;
});

test('route accepts a numeric subtitleIndex query and passes its number to the model', async () => {
    routeError = null;
    const beforeCalls = routeCalls.length;

    const response = await fetch(`${baseUrl}/videos/23/comments?subtitleIndex=4`);

    assert.equal(response.status, 200);
    assert.equal(routeCalls.length, beforeCalls + 1);
    assert.deepEqual(routeCalls.at(-1), { videoFileId: 23, subtitleIndex: 4 });
});

test('malformed, repeated, or out-of-range subtitleIndex values return 400 before the model', async () => {
    const urls = [
        ...['1.5', '-1', '9007199254740992', 'nope', '1e2', '4abc', ''].map(
            subtitleIndex => `${baseUrl}/videos/23/comments?subtitleIndex=${encodeURIComponent(subtitleIndex)}`,
        ),
        `${baseUrl}/videos/23/comments?subtitleIndex=4&subtitleIndex=5`,
    ];

    for (const url of urls) {
        const beforeCalls = routeCalls.length;
        const response = await fetch(url);
        assert.equal(response.status, 400, url);
        assert.equal(routeCalls.length, beforeCalls, url);
    }
});

test('malformed or unsafe videoFileId path values return 400 before the model', async () => {
    for (const videoFileId of ['1.5', '1e2', '4abc', '9007199254740992']) {
        const beforeCalls = routeCalls.length;
        const response = await fetch(`${baseUrl}/videos/${encodeURIComponent(videoFileId)}/comments`);
        assert.equal(response.status, 400, videoFileId);
        assert.equal(routeCalls.length, beforeCalls, videoFileId);
    }
});
