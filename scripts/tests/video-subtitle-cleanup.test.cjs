const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
require('reflect-metadata');
const ts = require('typescript');

function createModel(remove) {
    const filename = path.resolve(__dirname, '../../src/model/api/video/VideoUtil.ts');
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            esModuleInterop: true,
        },
    }).outputText;
    const directories = [];
    const fakeFs = {
        rmSync() {
            throw new Error('synchronous cleanup must not run');
        },
        promises: {
            rm: remove,
            mkdir: async directory => directories.push(directory),
            stat: async () => ({ size: 123, mtimeMs: 456 }),
        },
    };
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    loaded.require = request => {
        if (request === 'fs') return fakeFs;
        if (request.startsWith('.')) return {};
        return require(request);
    };
    loaded._compile(compiled, filename);
    const model = new loaded.exports.default({ getConfig: () => ({ temporaryDir: '/synthetic/字幕' }) }, {});
    const extractions = [];
    model.createPreparedSubtitle = async (...args) => {
        extractions.push(args);
        return { key: 'synthetic', filePath: '/synthetic/prepared.ass' };
    };
    return { model, directories, extractions };
}

test('subtitle preparation shares async cleanup and waits before creating or extracting files', async () => {
    let release;
    const removals = [];
    const state = createModel((...args) => {
        removals.push(args);
        return new Promise(resolve => {
            release = resolve;
        });
    });
    assert.equal(removals.length, 0);
    const first = state.model.prepareSubtitle('/synthetic/video.mkv', 0);
    const second = state.model.prepareSubtitle('/synthetic/video.mkv', 0);
    assert.equal(removals.length, 1);
    assert.deepEqual(removals[0][1], { force: true, recursive: true });
    assert.deepEqual(state.directories, []);
    assert.deepEqual(state.extractions, []);
    release();
    const results = await Promise.all([first, second]);
    assert.equal(state.extractions.length, 1);
    assert.equal(state.directories.length, 2);
    assert.deepEqual(results[0], results[1]);
});

test('failed cleanup prevents extraction and a later request retries it', async () => {
    let attempts = 0;
    const state = createModel(async () => {
        if (++attempts === 1) throw new Error('synthetic cleanup failure');
    });
    await assert.rejects(state.model.prepareSubtitle('/synthetic/video.mkv', 0), /synthetic cleanup failure/);
    assert.deepEqual(state.directories, []);
    assert.deepEqual(state.extractions, []);
    await state.model.prepareSubtitle('/synthetic/video.mkv', 0);
    assert.equal(attempts, 2);
    assert.equal(state.extractions.length, 1);
});
