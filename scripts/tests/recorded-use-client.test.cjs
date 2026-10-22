const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/RecordedUseClient.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loadedModule._compile(compiled, sourcePath);
const { RecordedUseClient } = loadedModule.exports;

const resource = (recordedId, videoFileId, purpose = 'test') => ({
    recordedId,
    ...(typeof videoFileId === 'undefined' ? {} : { videoFileId }),
    purpose,
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

test('acquire and release send request ids and release by the original acquire id', async () => {
    const requests = [];
    const client = new RecordedUseClient(async request => {
        requests.push(request);
        return undefined;
    });

    const lease = await client.acquire(resource(10, 20));
    await lease.release();

    assert.equal(requests.length, 2);
    assert.equal(requests[0].type, 'recorded-use');
    assert.equal(requests[0].op, 'acquire');
    assert.match(requests[0].id, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(requests[0].resource, resource(10, 20));
    assert.equal(requests[1].op, 'release');
    assert.equal(requests[1].leaseRequestId, requests[0].id);
    assert.notEqual(requests[1].id, requests[0].id);
});

test('stopUses stops overlapping leases and leaves another video file untouched', async () => {
    const requests = [];
    const stopped = [];
    const client = new RecordedUseClient(async request => {
        requests.push(request);
    });
    const whole = await client.acquire(resource(10, undefined, 'whole'), async () => stopped.push('whole'));
    const videoA = await client.acquire(resource(10, 20, 'a'), async () => stopped.push('a'));
    const videoB = await client.acquire(resource(10, 21, 'b'), async () => stopped.push('b'));

    await client.stopUses(10, 20);
    assert.deepEqual(stopped.sort(), ['a', 'whole']);
    assert.equal(requests.filter(request => request.op === 'release').length, 2);
    await client.stopUses(10, 20);

    await videoB.release();
    assert.equal(requests.filter(request => request.op === 'release').length, 3);
    await whole.release();
    await videoA.release();
});

test('stopUses for a recorded item stops every matching local lease', async () => {
    const stopped = [];
    const client = new RecordedUseClient(async () => undefined);
    await client.acquire(resource(12, 31), async () => stopped.push(31));
    await client.acquire(resource(12, 32), async () => stopped.push(32));
    await client.acquire(resource(13, 33), async () => stopped.push(33));

    await client.stopUses(12);

    assert.deepEqual(stopped.sort(), [31, 32]);
});

test('overlapping concurrent release calls share one ACK and release failures can be retried', async () => {
    const requests = [];
    const ack = deferred();
    let rejectRelease = true;
    const client = new RecordedUseClient(async request => {
        requests.push(request);
        if (request.op === 'release' && rejectRelease) {
            rejectRelease = false;
            throw new Error('release failed');
        }
        if (request.op === 'release' && requests.filter(item => item.op === 'release').length === 2) {
            return ack.promise;
        }
    });
    const lease = await client.acquire(resource(14, 40));

    await assert.rejects(lease.release(), /release failed/);
    const firstRetry = lease.release();
    const duplicateRetry = lease.release();
    assert.equal(requests.filter(request => request.op === 'release').length, 2);
    ack.resolve();
    await Promise.all([firstRetry, duplicateRetry]);
    await lease.release();
    assert.equal(requests.filter(request => request.op === 'release').length, 2);
});

test('an acquire timeout attempts cleanup with the same request id', async () => {
    const requests = [];
    const client = new RecordedUseClient(async request => {
        requests.push(request);
        if (request.op === 'acquire') throw new Error('RecordedUseIPCTimeout');
    });

    await assert.rejects(client.acquire(resource(15, 50)), /RecordedUseIPCTimeout/);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].op, 'acquire');
    assert.equal(requests[1].op, 'release');
    assert.equal(requests[1].leaseRequestId, requests[0].id);
});

test('stop failures are propagated and the lease remains held for a later retry', async () => {
    let stopCalls = 0;
    let releaseCalls = 0;
    const client = new RecordedUseClient(async request => {
        if (request.op === 'release') releaseCalls++;
    });
    await client.acquire(resource(16, 60), async () => {
        stopCalls++;
        throw new Error('stop failed');
    });

    await assert.rejects(client.stopUses(16, 60), /stop failed/);
    assert.equal(releaseCalls, 0);
    assert.equal(stopCalls, 1);
    await assert.rejects(client.stopUses(16, 60), /stop failed/);
    assert.equal(stopCalls, 2);
});

test('a lease without a stop callback cannot be cleared by stopUses', async () => {
    let releaseCalls = 0;
    const client = new RecordedUseClient(async request => {
        if (request.op === 'release') releaseCalls++;
    });
    const lease = await client.acquire(resource(17, 70));

    await assert.rejects(client.stopUses(17, 70), /RecordedResourceBusy/);
    assert.equal(releaseCalls, 0);
    await lease.release();
    assert.equal(releaseCalls, 1);
});
