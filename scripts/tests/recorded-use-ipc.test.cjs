const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

function loadTypeScript(sourcePath, dependencies = {}) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
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
            if (request in dependencies) return dependencies[request];
            if (request === 'inversify') return { inject: () => () => {}, injectable: () => target => target };
            if (request.startsWith('.')) return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, sourcePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports;
}

const registryPath = path.resolve(__dirname, '../../src/model/RecordedUseRegistry.ts');
const registryModule = loadTypeScript(registryPath);
const { recordedUseRegistry } = registryModule;
const messageDefinePath = path.resolve(__dirname, '../../src/model/ipc/IPCMessageDefine.ts');
const messageDefineModule = loadTypeScript(messageDefinePath);
const ipcServerPath = path.resolve(__dirname, '../../src/model/ipc/IPCServer.ts');
const { default: IPCServer } = loadTypeScript(ipcServerPath, {
    '../RecordedUseRegistry': registryModule,
    './IPCMessageDefine': messageDefineModule,
});

class FakeChild extends EventEmitter {
    constructor(pid) {
        super();
        this.pid = pid;
        this.connected = true;
        this.sent = [];
    }

    send(message, callback) {
        this.sent.push(message);
        this.emit('sent', message);
        callback?.(null);
    }
}

function createServer() {
    return new IPCServer({}, {}, {}, {}, {}, {}, {});
}

function emitAndWait(child, message) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('IPCReplyTimeout')), 1_000);
        const onSent = response => {
            if (response.id !== message.id) return;
            clearTimeout(timer);
            child.removeListener('sent', onSent);
            resolve(response);
        };
        child.on('sent', onSent);
        child.emit('message', message);
    });
}

async function emitMessage(child, message) {
    child.emit('message', message);
    await new Promise(resolve => setImmediate(resolve));
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const acquireMessage = (id, recordedId, videoFileId) => ({
    type: 'recorded-use',
    id,
    op: 'acquire',
    resource: {
        recordedId,
        ...(typeof videoFileId === 'undefined' ? {} : { videoFileId }),
        purpose: 'playback',
    },
});

test('raw acquire blocks deletion and raw release unblocks it', async () => {
    const server = createServer();
    const child = new FakeChild(701);
    server.register(child);
    const peer = server.getRecordedUsePeer(child);
    try {
        const acquire = await emitAndWait(child, acquireMessage('acquire-1', 7010, 8010));
        assert.deepEqual(acquire, { type: 'recorded-use-result', id: 'acquire-1', result: true });
        assert.equal(recordedUseRegistry.tryBeginDeletion(7010, 8010), null);

        const release = await emitAndWait(child, {
            type: 'recorded-use',
            id: 'release-1',
            op: 'release',
            leaseRequestId: 'acquire-1',
        });
        assert.deepEqual(release, { type: 'recorded-use-result', id: 'release-1', result: true });
        const deletion = recordedUseRegistry.tryBeginDeletion(7010, 8010);
        assert.notEqual(deletion, null);
        recordedUseRegistry.endDeletion(deletion);
    } finally {
        if (peer !== undefined) recordedUseRegistry.clearPeer(peer);
    }
});

test('duplicate acquire request ids reuse one lease and one release clears it', async () => {
    const server = createServer();
    const child = new FakeChild(702);
    server.register(child);
    const peer = server.getRecordedUsePeer(child);
    try {
        await emitAndWait(child, acquireMessage('duplicate-id', 7020));
        await emitAndWait(child, acquireMessage('duplicate-id', 7020));
        assert.equal(recordedUseRegistry.tryBeginDeletion(7020), null);
        await emitAndWait(child, {
            type: 'recorded-use',
            id: 'duplicate-release',
            op: 'release',
            leaseRequestId: 'duplicate-id',
        });
        const deletion = recordedUseRegistry.tryBeginDeletion(7020);
        assert.notEqual(deletion, null);
        recordedUseRegistry.endDeletion(deletion);
    } finally {
        if (peer !== undefined) recordedUseRegistry.clearPeer(peer);
    }
});

test('disconnect and exit mark each peer lease unknown without releasing it', async () => {
    const server = createServer();
    const disconnectedChild = new FakeChild(703);
    const exitedChild = new FakeChild(704);
    server.register(disconnectedChild);
    server.register(exitedChild);
    const disconnectPeer = server.getRecordedUsePeer(disconnectedChild);
    const exitPeer = server.getRecordedUsePeer(exitedChild);
    try {
        await emitAndWait(disconnectedChild, acquireMessage('disconnect-lease', 7030));
        await emitAndWait(exitedChild, acquireMessage('exit-lease', 7040));

        disconnectedChild.emit('disconnect');
        exitedChild.emit('exit', 1, null);

        assert.equal(recordedUseRegistry.tryBeginDeletion(7030), null);
        assert.equal(recordedUseRegistry.tryBeginDeletion(7040), null);
        const staleLease = [...recordedUseRegistry.leases.values()].find(lease => lease.peer === disconnectPeer);
        assert.ok(staleLease?.unknown);
        recordedUseRegistry.release(disconnectPeer, staleLease.id);
        assert.equal(recordedUseRegistry.isInUse(7030), true, 'unknown leases cannot be released by the stale peer');
    } finally {
        if (disconnectPeer !== undefined) recordedUseRegistry.clearPeer(disconnectPeer);
        if (exitPeer !== undefined) recordedUseRegistry.clearPeer(exitPeer);
    }
});

test('a late reply from an old child is sent to that child after a replacement registers', async () => {
    const server = createServer();
    const oldChild = new FakeChild(705);
    const newChild = new FakeChild(706);
    server.register(oldChild);
    const call = deferred();
    server.functions = { testModel: { slow: async () => call.promise } };

    await emitMessage(oldChild, { id: 'late-reply', model: 'testModel', func: 'slow' });
    server.register(newChild);
    call.resolve('old-result');
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(oldChild.sent, [{ id: 'late-reply', result: 'old-result' }]);
    assert.deepEqual(newChild.sent, []);
});

test('invalid recorded identifiers and oversized request ids receive typed errors', async () => {
    const server = createServer();
    const child = new FakeChild(707);
    server.register(child);
    const invalidResourceReply = await emitAndWait(
        child,
        acquireMessage('invalid-resource', Number.MAX_SAFE_INTEGER + 1),
    );
    assert.deepEqual(invalidResourceReply, {
        type: 'recorded-use-result',
        id: 'invalid-resource',
        error: 'InvalidRecordedId',
    });

    const oversizedId = 'x'.repeat(101);
    const oversizedIdReply = await emitAndWait(child, acquireMessage(oversizedId, 7070));
    assert.deepEqual(oversizedIdReply, {
        type: 'recorded-use-result',
        id: oversizedId,
        error: 'InvalidRecordedUseRequest',
    });
});
