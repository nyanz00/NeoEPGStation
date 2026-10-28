'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { Writable } = require('node:stream');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/operator/recording/RecorderModel.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        experimentalDecorators: true,
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
    fileName: sourcePath,
}).outputText;
const warnings = [];
const storageSync = { WRITER_CLOSE_TIMEOUT_MS: 35 };
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath) {
        if (request === 'inversify') return { inject: () => () => {}, injectable: () => target => target };
        if (request.startsWith('./RecordingStorageSync')) {
            return { __esModule: true, default: storageSync };
        }
        if (request.startsWith('.')) return { __esModule: true, default: class {}, recordingScheduler: {} };
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const RecorderModel = loadedModule.exports.default;

function makeModel(recFile) {
    const model = Object.create(RecorderModel.prototype);
    model.recFile = recFile;
    model.reserve = { id: 123 };
    model.log = { system: { warn: message => warnings.push(message), error() {} } };
    return model;
}

function makeSource() {
    return {
        destroyed: false,
        readableEnded: false,
        readableLength: 0,
        isPaused: () => false,
        socket: { bytesRead: 10 },
    };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('drains the source until both the writer buffer and drain flag clear', async () => {
    for (const writerState of [
        { writableLength: 12, writableNeedDrain: false },
        { writableLength: 0, writableNeedDrain: true },
    ]) {
        const writer = { ...writerState };
        const model = makeModel(writer);
        const source = makeSource();
        let resolved = false;
        const draining = model.readArrivedStreamData(source).then(() => { resolved = true; });

        await tick();
        await tick();
        assert.equal(resolved, false, `must wait while writer state is ${JSON.stringify(writerState)}`);

        writer.writableLength = 0;
        writer.writableNeedDrain = false;
        await draining;
        assert.equal(resolved, true);
    }
});

test('returns immediately when the recording writer is absent', async () => {
    const model = makeModel(null);
    await model.readArrivedStreamData(makeSource());
});

test('waits for the recording writer to finish and reports a bounded timeout once', async () => {
    warnings.length = 0;
    const writer = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const model = makeModel(writer);
    let resolved = false;
    const waiting = model.waitForRecordingFileClosed().then(value => {
        resolved = true;
        return value;
    });

    await tick();
    assert.equal(resolved, false, 'the close waiter must remain pending while the writer is open');
    writer.end();
    assert.equal(await waiting, true);
    assert.equal(resolved, true);
    writer.destroy();

    const stuckWriter = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const timeoutModel = makeModel(stuckWriter);
    assert.equal(await timeoutModel.waitForRecordingFileClosed(), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /recording writer close timed out: 123/);
    stuckWriter.destroy();
});
