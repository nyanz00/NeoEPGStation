const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/epgUpdater/EPGUpdateExecutorManageModel.ts');

function createChild() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.pid = 123;
    child.sentMessages = [];
    child.send = (message, callback) => {
        child.sentMessages.push(message);
        callback?.(null);
    };
    child.killCalls = [];
    child.kill = signal => child.killCalls.push(signal);
    return child;
}

function loadManager(children) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
        },
        fileName: sourcePath,
    }).outputText;
    const spawnCalls = [];
    const mocks = {
        child_process: {
            spawn: (...args) => {
                spawnCalls.push(args);
                const child = createChild();
                children.push(child);
                return child;
            },
        },
        inversify: {
            inject: () => () => {},
            injectable: () => target => target,
        },
        path,
        '../../util/ProcessUtil': { default: { kill: async child => child.emit('exit', null, 'SIGKILL') } },
    };
    const loadedModule = { exports: {} };
    vm.runInNewContext(
        compiled,
        {
            exports: loadedModule.exports,
            module: loadedModule,
            require: request => {
                return mocks[request] ?? {};
            },
            __dirname: path.dirname(sourcePath),
            process: { argv: ['node'] },
            setTimeout,
            clearTimeout,
        },
        { filename: sourcePath },
    );
    return { EPGUpdateExecutorManageModel: loadedModule.exports.default, spawnCalls };
}

function createManager(EPGUpdateExecutorManageModel) {
    const logs = [];
    const logger = {
        system: {
            info: message => logs.push(['info', message]),
            fatal: message => logs.push(['fatal', message]),
            error: error => logs.push(['error', error]),
            warn: message => logs.push(['warn', message]),
        },
    };
    const manager = new EPGUpdateExecutorManageModel({ getLogger: () => logger }, { emitUpdated: () => {} });
    return { manager, logs };
}

test('shutdown IPC exit followed by close, disconnect, and error does not respawn', async () => {
    const children = [];
    const { EPGUpdateExecutorManageModel, spawnCalls } = loadManager(children);
    const { manager } = createManager(EPGUpdateExecutorManageModel);

    await manager.execute();
    const child = children[0];
    const shutdown = manager.shutdown();
    assert.deepEqual(
        child.sentMessages.map(message => message.type),
        ['update-shutdown-request'],
    );
    child.emit('exit', 0, null);
    await shutdown;

    child.emit('close', 0, null);
    child.emit('disconnect');
    child.emit('error', new Error('late child error'));

    assert.equal(spawnCalls.length, 1);
    assert.equal(children.length, 1);
});

test('an executor exit before shutdown keeps the existing restart behavior', async () => {
    const children = [];
    const { EPGUpdateExecutorManageModel, spawnCalls } = loadManager(children);
    const { manager } = createManager(EPGUpdateExecutorManageModel);

    await manager.execute();
    children[0].emit('exit', 1, null);

    assert.equal(spawnCalls.length, 2);
    assert.equal(children.length, 2);
});

test('shutdown before first execute prevents spawning an executor', async () => {
    const children = [];
    const { EPGUpdateExecutorManageModel, spawnCalls } = loadManager(children);
    const { manager } = createManager(EPGUpdateExecutorManageModel);

    await manager.shutdown();
    await manager.execute();

    assert.equal(spawnCalls.length, 0);
    assert.equal(children.length, 0);
});
