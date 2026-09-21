const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

const sourcePath = path.resolve(__dirname, '../../src/model/service/encode/EncodeFinishModel.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const load = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath && request.startsWith('.')) {
        return {};
    }
    return load.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = load;
}
const EncodeFinishModel = loadedModule.exports.default;

function createModel({ failMethod } = {}) {
    const calls = [];
    const apiCall = method => async () => {
        calls.push(method);
        if (failMethod === method) {
            throw new Error(`${method} failed`);
        }
        return 10;
    };
    const model = Object.create(EncodeFinishModel.prototype);
    Object.assign(model, {
        log: { encode: { error: () => calls.push('logError') } },
        socket: { notifyClient: () => calls.push('notifyClient') },
        encodeEvent: { emitErrorEncode: () => calls.push('emitErrorEncode') },
        ipc: {
            recorded: {
                addVideoFile: apiCall('addVideoFile'),
                updateVideoFileSize: apiCall('updateVideoFileSize'),
                deleteVideoFile: apiCall('deleteVideoFile'),
            },
            thumbnail: { replace: apiCall('replaceThumbnail') },
            encodeEvent: { emitFinishEncode: apiCall('emitFinishEncode') },
        },
    });
    return { model, calls };
}

const encodeInfo = {
    recordedId: 1,
    videoFileId: 2,
    parentDirName: 'recorded',
    filePath: 'encoded.mkv',
    fullOutputPath: 'C:\\recorded\\encoded.mkv',
    mode: 'H264',
    removeOriginal: true,
    updateThumbnail: true,
};

test('database registration failure preserves the original and stops success processing', async () => {
    const { model, calls } = createModel({ failMethod: 'addVideoFile' });

    await model.finishEncode({ ...encodeInfo });

    assert.deepEqual(calls, ['addVideoFile', 'logError', 'logError', 'logError', 'emitErrorEncode']);
});

test('existing file size update failure preserves the original and stops success processing', async () => {
    const { model, calls } = createModel({ failMethod: 'updateVideoFileSize' });

    await model.finishEncode({ ...encodeInfo, filePath: null, fullOutputPath: null });

    assert.deepEqual(calls, ['updateVideoFileSize', 'logError', 'logError', 'emitErrorEncode']);
});

test('successful database registration allows thumbnail update, source deletion, and finish notification', async () => {
    const { model, calls } = createModel();

    await model.finishEncode({ ...encodeInfo });

    assert.deepEqual(calls, [
        'addVideoFile',
        'replaceThumbnail',
        'deleteVideoFile',
        'notifyClient',
        'emitFinishEncode',
    ]);
});
