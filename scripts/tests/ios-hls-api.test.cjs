'use strict';

require('./ts-cjs-compat.cjs');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const test = require('node:test');
const express = require('express');
const openapi = require('express-openapi');
const yaml = require('js-yaml');
const ts = require('typescript');

let activeStreamApiModel;

const container = {
    get(token) {
        assert.equal(token, 'IStreamApiModel');
        return activeStreamApiModel;
    },
};

function loadTypeScriptRoute(sourcePath) {
    const absolutePath = path.resolve(__dirname, sourcePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const load = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath) {
            if (request.includes('ModelContainer')) return { __esModule: true, default: container };
            if (request === '../../../../../api' || request === '../../../../../../api') {
                return {
                    responseServerError(res, message) {
                        res.status(500).json({ message });
                    },
                };
            }
            if (request.startsWith('.')) return {};
        }
        return load.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = load;
    }

    return loadedModule.exports;
}

const playlistRoute = loadTypeScriptRoute(
    '../../src/model/service/api/streams/recorded/{videoFileId}/vodhls/playlist.ts',
);
const segmentRoute = loadTypeScriptRoute(
    '../../src/model/service/api/streams/recorded/{videoFileId}/vodhls/segments/{sequence}.ts',
);

test('recorded VOD HLS accepts only the documented iOS client on playlist and segment routes', async t => {
    const calls = [];
    activeStreamApiModel = {
        async getRecordedVODHLSPlaylist(option) {
            calls.push({ route: 'playlist', option });
            return '#EXTM3U\n';
        },
        async createRecordedVODHLSSegmentStream(option, sequence) {
            calls.push({ route: 'segment', option, sequence });
            return {
                process: null,
                processes: [],
                cleanup: async () => {},
                stream: Readable.from(Buffer.from('segment')),
            };
        },
    };

    const apiDoc = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../api.yml'), 'utf8'));
    apiDoc.servers = [{ url: 'http://localhost/api' }];
    const app = express();
    app.set('query parser', 'extended');
    app.use((req, _res, next) => {
        Object.defineProperty(req, 'query', {
            value: req.query,
            writable: true,
            configurable: true,
            enumerable: true,
        });
        next();
    });
    await openapi.initialize({
        apiDoc,
        app,
        errorMiddleware: (err, _req, res, _next) => res.status(400).json({ message: err.message }),
        paths: [
            {
                path: '/streams/recorded/{videoFileId}/vodhls/playlist',
                module: playlistRoute,
            },
            {
                path: '/streams/recorded/{videoFileId}/vodhls/segments/{sequence}',
                module: segmentRoute,
            },
        ],
    });

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(
        () =>
            new Promise(resolve => {
                server.close(resolve);
                server.closeAllConnections();
            }),
    );
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/streams/recorded/123/vodhls`;
    const endpoints = [
        {
            name: 'playlist',
            path: `${baseUrl}/playlist`,
            expectedBody: '#EXTM3U\n',
        },
        {
            name: 'segment',
            path: `${baseUrl}/segments/4`,
            expectedBody: 'segment',
        },
    ];

    for (const endpoint of endpoints) {
        for (const [query, expectedClient] of [
            ['?ss=0&mode=1&client=ios', 'ios'],
            ['?ss=0&mode=1', undefined],
        ]) {
            const response = await fetch(endpoint.path + query);
            assert.equal(response.status, 200, `${endpoint.name} ${query}`);
            assert.equal(await response.text(), endpoint.expectedBody);
            assert.equal(calls.at(-1).route, endpoint.name);
            assert.equal(calls.at(-1).option.client, expectedClient);
            if (endpoint.name === 'segment') assert.equal(calls.at(-1).sequence, 4);
        }

        const callCount = calls.length;
        const invalidResponse = await fetch(endpoint.path + '?ss=0&mode=1&client=android');
        assert.equal(invalidResponse.status, 400, `${endpoint.name} must reject unknown clients`);
        await invalidResponse.text();
        assert.equal(calls.length, callCount, 'invalid clients must not reach the stream model');
    }
});
