const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadIPCServer(registry) {
    const absolutePath = path.resolve(__dirname, '../..', 'src/model/ipc/IPCServer.ts');
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
            if (request === '../RecordedUseRegistry') return { recordedUseRegistry: registry };
            if (request === '../encode/EncodeTaskIntake') return { persistEncodeRequest: registry.persist };
            return {};
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

function makeRegistry() {
    const events = [];
    let inUse = false;
    return {
        events,
        get inUse() {
            return inUse;
        },
        acquire(peer, resource) {
            events.push({ type: 'acquire', peer, resource });
            inUse = true;
            return 'lease-1';
        },
        release(peer, lease) {
            events.push({ type: 'release', peer, lease });
            inUse = false;
        },
    };
}

function makeServer(registry, persist, child = null) {
    registry.persist = persist;
    const IPCServer = loadIPCServer(registry);
    const server = Object.create(IPCServer.prototype);
    server.dbOperator = { marker: 'db' };
    server.configuration = { getConfig: () => ({ encodeMaxPending: 7 }) };
    server.child = child;
    return server;
}

const request = { recordedId: 23, sourceVideoFileId: 41, mode: 'synthetic' };

test('persists before notifying a connected child and sends only the persisted id', async () => {
    const registry = makeRegistry();
    const sent = [];
    const child = { connected: true, send: message => sent.push(message) };
    let releasePersistence;
    const persistence = new Promise(resolve => (releasePersistence = resolve));
    const server = makeServer(
        registry,
        async (dbOperator, option, maxPending) => {
            assert.equal(registry.inUse, true);
            assert.equal(dbOperator.marker, 'db');
            assert.deepEqual(option, request);
            assert.equal(maxPending, 7);
            await persistence;
            return { ...option, encodeId: 812 };
        },
        child,
    );

    const setting = server.setEncode(request);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(registry.inUse, true);
    assert.deepEqual(sent, []);
    releasePersistence();
    await setting;

    assert.deepEqual(sent, [{ type: 'pushEncode', value: 812 }]);
    assert.equal(registry.inUse, false);
    assert.deepEqual(
        registry.events.map(event => event.type),
        ['acquire', 'release'],
    );
    assert.deepEqual(registry.events[0].resource, {
        recordedId: 23,
        videoFileId: 41,
        purpose: 'encode-intake',
    });
});

test('persists even when no child is registered and does not publish an unpersisted request', async () => {
    const registry = makeRegistry();
    let persisted = false;
    const server = makeServer(registry, async () => {
        persisted = true;
        return { ...request, encodeId: 3 };
    });

    await server.setEncode(request);
    assert.equal(persisted, true);
    assert.equal(registry.inUse, false);
});

test('does not notify the child when database persistence fails and releases the intake lease', async () => {
    const registry = makeRegistry();
    const sent = [];
    const child = { connected: true, send: message => sent.push(message) };
    const server = makeServer(
        registry,
        async () => {
            assert.equal(registry.inUse, true);
            throw new Error('synthetic database failure');
        },
        child,
    );

    await assert.rejects(server.setEncode(request), { message: 'synthetic database failure' });
    assert.deepEqual(sent, []);
    assert.equal(registry.inUse, false);
    assert.deepEqual(
        registry.events.map(event => event.type),
        ['acquire', 'release'],
    );
});
