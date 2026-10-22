const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

function loadTypeScript(relativePath, stubs = {}) {
    const absolutePath = path.resolve(__dirname, '../..', relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
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
            if (request === 'inversify') return { inject: () => () => {}, injectable: () => target => target };
            if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
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

const BoundedWorkQueue = loadTypeScript('src/util/BoundedWorkQueue.ts');
const ThumbnailManageModel = loadTypeScript('src/model/operator/thumbnail/ThumbnailManageModel.ts', {
    '../../../util/BoundedWorkQueue': { __esModule: true, default: BoundedWorkQueue },
    '../../../util/FileUtil': { __esModule: true, default: {} },
    '../../../util/ProcessUtil': { __esModule: true, default: {} },
    '../../../db/entities/Thumbnail': { __esModule: true, default: class Thumbnail {} },
});

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

test('a running task is separate from the bounded pending count and accepted tasks keep FIFO order', async () => {
    const queue = new BoundedWorkQueue(2);
    const started = deferred();
    const release = deferred();
    const order = [];
    const running = queue.enqueue(async () => {
        order.push('running');
        started.resolve();
        await release.promise;
    });
    await started.promise;
    const pendingOne = queue.enqueue(() => order.push('pending-1'));
    const pendingTwo = queue.enqueue(() => order.push('pending-2'));

    await assert.rejects(
        queue.enqueue(() => order.push('overflow')),
        { message: 'BoundedWorkQueueFullError' },
    );
    release.resolve();
    await Promise.all([running, pendingOne, pendingTwo]);

    assert.deepEqual(order, ['running', 'pending-1', 'pending-2']);
});

test('a failed task rejects its caller but does not stop accepted work', async () => {
    const queue = new BoundedWorkQueue(1);
    const started = deferred();
    const release = deferred();
    const first = queue.enqueue(async () => {
        started.resolve();
        await release.promise;
        throw new Error('task failed');
    });
    await started.promise;
    const second = queue.enqueue(() => 'finished');
    release.resolve();

    await assert.rejects(first, /task failed/);
    assert.equal(await second, 'finished');
});

test('ThumbnailManageModel applies thumbnailMaxPending from configuration', async () => {
    const model = new ThumbnailManageModel(
        { getLogger: () => ({ system: { info() {}, warn() {}, error() {}, debug() {} } }) },
        { getConfig: () => ({ thumbnailMaxPending: 1 }) },
        {},
        {},
        {},
        {},
        {},
    );
    const started = deferred();
    const release = deferred();
    const running = model.enqueue(async () => {
        started.resolve();
        await release.promise;
    });
    await started.promise;
    const pending = model.enqueue(() => 'accepted');

    await assert.rejects(
        model.enqueue(() => 'rejected'),
        { message: 'BoundedWorkQueueFullError' },
    );
    release.resolve();
    await running;
    assert.equal(await pending, 'accepted');
});

test('zero pending capacity still permits an idle queue to start one task immediately', async () => {
    const queue = new BoundedWorkQueue(0);
    const started = deferred();
    const release = deferred();
    const running = queue.enqueue(async () => {
        started.resolve();
        await release.promise;
    });
    await started.promise;

    await assert.rejects(
        queue.enqueue(() => {}),
        { message: 'BoundedWorkQueueFullError' },
    );
    release.resolve();
    await running;
});
