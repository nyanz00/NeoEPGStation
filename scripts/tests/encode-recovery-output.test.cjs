const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadEncodeManageModel() {
    const absolutePath = path.resolve(__dirname, '../..', 'src/model/service/encode/EncodeManageModel.ts');
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            emitDecoratorMetadata: true,
            experimentalDecorators: true,
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
        fileName: absolutePath,
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath) {
            const withoutJs = request.replace(/\.js$/, '');
            if (request === 'inversify') return { inject: () => () => {}, injectable: () => target => target };
            if (withoutJs === '../../RecordedUseClient')
                return { recordedUseClient: { acquire: async () => ({ release: async () => {} }) } };
            if (withoutJs === '../../encode/EncodeTaskIntake')
                return { persistEncodeRequest: async () => assert.fail('not used') };
            if (request.startsWith('.')) return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports.default;
}

const EncodeManageModel = loadEncodeManageModel();

function createModel({ task, roots, files, provider } = {}) {
    const saved = [];
    const deleted = [];
    const repository = {
        find: async () => (task === undefined ? [] : [task]),
        save: async row => saved.push({ ...row }),
        delete: async where => deleted.push(where),
    };
    const model = Object.create(EncodeManageModel.prototype);
    Object.assign(model, {
        ownerFingerprint: 'test-owner',
        waitQueue: [],
        scheduledQueue: [],
        recoveryQueue: new Map(),
        configure: { getConfig: () => ({ encode: [{ name: 'normal-mode', type: 'normal' }], recorded: roots ?? [] }) },
        dbOperator: {
            getConnection: async () => ({ getRepository: () => repository }),
        },
        videoFileDB: { findAll: async () => files ?? [] },
        encoderModelProvider:
            provider ??
            (async () => ({
                setOption(option) {
                    this.option = option;
                },
            })),
        log: { encode: { info() {}, warn() {}, error() {} } },
        encodeEvent: { emitUpdateEncode() {} },
        saveWaitQueuePositions: async () => {},
        saveScheduledQueuePositions: async () => {},
        refreshScheduledTimer() {},
        sortScheduledQueue() {},
        emitNeedsCheckQueue() {},
        restorePromise: Promise.resolve(),
    });
    return { model, saved, deleted, repository };
}

function makeTask({ status = 'running', output, scheduledAt } = {}) {
    const option = {
        encodeId: 8,
        recordedId: 2,
        sourceVideoFileId: 10,
        mode: 'normal-mode',
        parentDir: 'recorded',
        removeOriginal: false,
        ...(scheduledAt === undefined ? {} : { scheduledAt }),
    };
    return {
        encodeId: 8,
        optionJson: JSON.stringify(option),
        status,
        ownerFingerprint: 'test-owner',
        position: 0,
        startedAt: status === 'running' ? 100 : 0,
        outputFilePath: output ?? null,
        createdAt: 1,
        updatedAt: 2,
    };
}

function recordedFile(id, filePath, parentDirectoryName = 'recorded') {
    return { id, filePath, parentDirectoryName };
}

test('deletes only the stale running task when its output is already registered', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-encode-registered-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const root = path.join(directory, 'recorded');
    fs.mkdirSync(root);
    const registeredPath = path.join(root, 'finished.mp4');
    fs.writeFileSync(registeredPath, 'registered output');
    let providerCalls = 0;
    const { model, deleted } = createModel({
        task: makeTask({ output: registeredPath }),
        roots: [{ name: 'recorded', path: root }],
        files: [recordedFile(10, 'source.ts'), recordedFile(11, 'finished.mp4')],
        provider: async () => {
            providerCalls++;
            throw new Error('registered output must not restart');
        },
    });

    await model.restorePersistedQueue();
    assert.deepEqual(deleted, [{ encodeId: 8 }]);
    assert.equal(providerCalls, 0);
    assert.deepEqual(model.waitQueue, []);
    assert.equal(fs.readFileSync(registeredPath, 'utf8'), 'registered output');
});

test('unlinks an unregistered output inside the recorded root before queueing recovery', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-encode-safe-output-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const root = path.join(directory, 'recorded');
    fs.mkdirSync(root);
    const sourcePath = path.join(root, 'source.ts');
    const outputPath = path.join(root, 'interrupted.mp4');
    fs.writeFileSync(sourcePath, 'source');
    fs.writeFileSync(outputPath, 'partial output');
    const { model } = createModel({
        task: makeTask({ output: outputPath }),
        roots: [{ name: 'recorded', path: root }],
        files: [recordedFile(10, 'source.ts')],
    });

    await model.restorePersistedQueue();
    assert.equal(fs.existsSync(outputPath), false);
    assert.equal(model.waitQueue.length, 1);
    assert.equal(model.waitQueue[0].option.recoveryOutputFilePath, outputPath);
});

test('marks an outside-root output as needs_attention without unlinking or queueing', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-encode-outside-output-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const root = path.join(directory, 'recorded');
    fs.mkdirSync(root);
    const sourcePath = path.join(root, 'source.ts');
    const outsideOutput = path.join(directory, 'outside.mp4');
    fs.writeFileSync(sourcePath, 'source');
    fs.writeFileSync(outsideOutput, 'keep');
    const task = makeTask({ output: outsideOutput });
    const { model, saved } = createModel({
        task,
        roots: [{ name: 'recorded', path: root }],
        files: [recordedFile(10, 'source.ts')],
    });

    await model.restorePersistedQueue();
    assert.equal(fs.readFileSync(outsideOutput, 'utf8'), 'keep');
    assert.equal(task.status, 'needs_attention');
    assert.equal(saved[0].status, 'needs_attention');
    assert.equal(model.waitQueue.length, 0);
    assert.equal(model.recoveryQueue.has(task.encodeId), true);
});

test('marks the source file itself as needs_attention and never unlinks it', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-encode-source-output-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const root = path.join(directory, 'recorded');
    fs.mkdirSync(root);
    const sourcePath = path.join(root, 'source.ts');
    fs.writeFileSync(sourcePath, 'source');
    const task = makeTask({ output: sourcePath });
    const { model, saved } = createModel({
        task,
        roots: [{ name: 'recorded', path: root }],
        files: [recordedFile(10, 'source.ts')],
    });

    await model.restorePersistedQueue();
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), 'source');
    assert.equal(saved[0].status, 'needs_attention');
    assert.equal(model.waitQueue.length, 0);
});

test('restores future pending tasks with scheduledAt to the scheduled queue', async () => {
    const scheduledAt = Date.now() + 60_000;
    const task = makeTask({ status: 'pending', scheduledAt });
    const { model } = createModel({ task });

    await model.restorePersistedQueue();
    assert.deepEqual(model.waitQueue, []);
    assert.equal(model.scheduledQueue.length, 1);
    assert.equal(model.scheduledQueue[0].option.encodeId, task.encodeId);
    assert.equal(model.scheduledQueue[0].scheduledAt, scheduledAt);
});

test('pushPersisted does not resurrect a pending task deleted after IPC publication', async () => {
    let providerCalls = 0;
    const { model } = createModel({
        provider: async () => {
            providerCalls++;
            throw new Error('deleted task must not be restored');
        },
    });
    model.dbOperator = {
        getConnection: async () => ({
            getRepository: () => ({ findOne: async () => null }),
        }),
    };

    await model.pushPersisted(8);
    assert.equal(providerCalls, 0);
    assert.deepEqual(model.waitQueue, []);
    assert.deepEqual(model.scheduledQueue, []);
});
