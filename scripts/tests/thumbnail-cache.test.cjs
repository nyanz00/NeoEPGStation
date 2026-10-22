const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/service/api/thumbnails/{thumbnailId}.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
    fileName: sourcePath,
}).outputText;

let thumbnailApiModel;
let routeCalls;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath) {
        if (request === '../../../ModelContainer') {
            return { __esModule: true, default: { get: () => thumbnailApiModel } };
        }
        if (request === '../../api') {
            return {
                responseFile: (...args) => {
                    routeCalls.push(['file', ...args.slice(2)]);
                    if (routeCalls.throwFileError) throw new Error('file disappeared');
                },
                responseError: (res, reason) => {
                    routeCalls.push(['error', reason.code]);
                },
                responseServerError: (res, message) => {
                    routeCalls.push(['server-error', message]);
                },
            };
        }
        if (request.startsWith('.')) return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const getThumbnail = loadedModule.exports.get;

function createResponse() {
    const headers = {};
    return {
        headers,
        setHeader: (name, value) => {
            headers[name] = value;
        },
    };
}

async function invokeRoute(filePath) {
    routeCalls = [];
    const response = createResponse();
    thumbnailApiModel = { getIdFilePath: async () => filePath };
    await getThumbnail({ params: { thumbnailId: '42' } }, response);
    return { response, calls: routeCalls };
}

test('successful JPEG responses receive a private four-hour cache lifetime', async () => {
    const { response, calls } = await invokeRoute('thumbnail.jpg');

    assert.equal(response.headers['Cache-Control'], 'private, max-age=14400');
    assert.deepEqual(calls[0], ['file', 'thumbnail.jpg', 'image/jpeg', false]);
});

test('missing thumbnails keep the no-cache policy', async () => {
    const { response, calls } = await invokeRoute(null);

    assert.equal(response.headers['Cache-Control'], 'private, no-cache, no-store, must-revalidate');
    assert.deepEqual(calls, [['error', 404]]);
});

test('lookup and file-response failures keep the no-cache policy', async t => {
    const responseFailure = createResponse();
    routeCalls = [];
    thumbnailApiModel = { getIdFilePath: async () => 'thumbnail.jpg' };
    routeCalls.throwFileError = true;
    await getThumbnail({ params: { thumbnailId: '42' } }, responseFailure);
    assert.equal(responseFailure.headers['Cache-Control'], 'private, no-cache, no-store, must-revalidate');
    assert.deepEqual(routeCalls.at(-1), ['server-error', 'file disappeared']);

    const lookupFailure = createResponse();
    routeCalls = [];
    thumbnailApiModel = {
        getIdFilePath: async () => {
            throw new Error('lookup failed');
        },
    };
    await getThumbnail({ params: { thumbnailId: '42' } }, lookupFailure);
    assert.equal(lookupFailure.headers['Cache-Control'], 'private, no-cache, no-store, must-revalidate');
    assert.deepEqual(routeCalls, [['server-error', 'lookup failed']]);
});
