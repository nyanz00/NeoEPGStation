const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/operator/externalCommand/ExternalCommandManageModel.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        experimentalDecorators: true,
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath) {
        if (request === 'inversify') return { inject: () => () => {}, injectable: target => target };
        if (request.startsWith('.')) return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const ExternalCommandManageModel = loadedModule.exports.default;

function deferred() {
    let resolve;
    const promise = new Promise(res => {
        resolve = res;
    });
    return { promise, resolve };
}

class PromiseQueue {
    queue = Promise.resolve();

    add(job) {
        const result = this.queue.then(job);
        this.queue = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
}

test('external command queue caps waiting work, logs overflow, and continues after a failed command', async () => {
    const errors = [];
    const model = Object.create(ExternalCommandManageModel.prototype);
    Object.assign(model, {
        config: { externalCommandMaxPending: 2 },
        maxPendingCommands: 2,
        pendingCommands: 0,
        queue: new PromiseQueue(),
        log: { system: { error: value => errors.push(String(value)) } },
    });

    const firstStarted = deferred();
    const releaseFirst = deferred();
    const started = [];
    model.createReserveCmd = async (_cmd, reserve) => {
        started.push(reserve.id);
        if (reserve.id === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
        }
        if (reserve.id === 2) throw new Error('expected command failure');
    };

    model.addReserve('test-command', { id: 1 });
    await firstStarted.promise;
    model.addReserve('test-command', { id: 2 });
    model.addReserve('test-command', { id: 3 });
    model.addReserve('test-command', { id: 4 });

    assert.equal(model.pendingCommands, 2);
    assert.ok(errors.some(message => message.includes('queue full') && message.includes('test-command')));

    releaseFirst.resolve();
    await model.queue.queue;

    assert.deepEqual(started, [1, 2, 3]);
    assert.ok(errors.some(message => message.includes('execute cmd error: test-command')));
    assert.equal(model.pendingCommands, 0);
});
