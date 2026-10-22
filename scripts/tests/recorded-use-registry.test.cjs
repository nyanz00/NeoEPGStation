const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/RecordedUseRegistry.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loadedModule._compile(compiled, sourcePath);
const RecordedUseRegistry = loadedModule.exports.default;

const recordedUse = (recordedId, videoFileId, extra = {}) => ({
    recordedId,
    ...(typeof videoFileId === 'undefined' ? {} : { videoFileId }),
    purpose: 'playback',
    ...extra,
});

test('whole-recording uses block deletion of the recording and any one video file', () => {
    const registry = new RecordedUseRegistry();
    registry.acquire('service-a', recordedUse(10, undefined));

    assert.equal(registry.tryBeginDeletion(10), null);
    assert.equal(registry.tryBeginDeletion(10, 101), null);
    assert.equal(registry.isInUse(10), true);
    assert.equal(registry.isInUse(10, 101), true);
});

test('a video-specific use only blocks deletion of that video, while whole-record deletion is blocked', () => {
    const registry = new RecordedUseRegistry();
    const lease = registry.acquire('service-a', recordedUse(10, 101));

    const otherVideoDeletion = registry.tryBeginDeletion(10, 102);
    assert.notEqual(otherVideoDeletion, null);
    assert.equal(registry.tryBeginDeletion(10, 101), null);
    assert.equal(registry.tryBeginDeletion(10), null);
    registry.endDeletion(otherVideoDeletion);

    registry.release('service-a', lease);
    assert.notEqual(registry.tryBeginDeletion(10, 101), null);
});

test('deletion reservation blocks overlapping acquisitions and conflicting deletion tokens', () => {
    const registry = new RecordedUseRegistry();
    const wholeDelete = registry.tryBeginDeletion(10);
    assert.notEqual(wholeDelete, null);
    assert.throws(() => registry.acquire('service-a', recordedUse(10, 101)), {
        message: 'RecordedResourceDeleting',
    });
    assert.equal(registry.tryBeginDeletion(10, 101), null);
    assert.notEqual(registry.tryBeginDeletion(11, 101), null);

    registry.endDeletion(wholeDelete);
    registry.endDeletion(wholeDelete);
    assert.notEqual(registry.acquire('service-a', recordedUse(10, 101)), '');
});

test('release is idempotent and cannot release another peer lease', () => {
    const registry = new RecordedUseRegistry();
    const lease = registry.acquire('service-a', recordedUse(10, 101));

    registry.release('service-b', lease);
    assert.equal(registry.isInUse(10), true);
    registry.release('service-a', lease);
    registry.release('service-a', lease);
    assert.equal(registry.isInUse(10), false);
});

test('unknown leases block deletion until confirmed peer cleanup, with durable-key transfer scoped to the exact resource', () => {
    const registry = new RecordedUseRegistry();
    const durableLease = registry.acquire(
        'service-old',
        recordedUse(10, 101, { durableKey: 'amatsukaze:job-1', purpose: 'encoding' }),
    );
    registry.acquire('service-old', recordedUse(10, 102, { purpose: 'playback' }));
    registry.markPeerUnknown('service-old');

    assert.equal(registry.tryBeginDeletion(10), null);
    assert.equal(registry.tryBeginDeletion(10, 101), null);
    registry.release('service-old', durableLease);
    assert.equal(registry.isInUse(10, 101), true);
    const wrongVideoLease = registry.acquire('service-new', recordedUse(10, 102, { durableKey: 'amatsukaze:job-1' }));
    const wrongRecordedLease = registry.acquire(
        'service-new',
        recordedUse(11, 101, { durableKey: 'amatsukaze:job-1' }),
    );
    assert.notEqual(wrongVideoLease, durableLease);
    assert.notEqual(wrongRecordedLease, durableLease);
    assert.equal(
        registry.acquire('service-new', recordedUse(10, 101, { durableKey: 'amatsukaze:job-1' })),
        durableLease,
    );

    registry.release('service-old', durableLease);
    assert.equal(registry.isInUse(10, 101), true);
    registry.release('service-new', durableLease);
    assert.equal(registry.isInUse(10), true);
    registry.release('service-new', wrongVideoLease);
    registry.release('service-new', wrongRecordedLease);
    registry.clearPeer('service-old');
    assert.equal(registry.isInUse(10), false);
});

test('durable keys cannot take over leases from a live peer', () => {
    const registry = new RecordedUseRegistry();
    const lease = registry.acquire('service-a', recordedUse(10, 101, { durableKey: 'job-1' }));

    const secondLease = registry.acquire('service-b', recordedUse(10, 101, { durableKey: 'job-1' }));
    assert.notEqual(secondLease, lease);
    registry.release('service-b', secondLease);
    assert.equal(registry.isInUse(10), true);
});

test('resource identifiers must be positive safe integers', () => {
    const registry = new RecordedUseRegistry();
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
        assert.throws(() => registry.acquire('service-a', recordedUse(invalid, undefined)));
        assert.throws(() => registry.tryBeginDeletion(invalid));
        assert.throws(() => registry.isInUse(invalid));
    }
    assert.throws(() => registry.acquire('service-a', recordedUse(1, 0)));
    assert.throws(() => registry.tryBeginDeletion(1, 0));
    assert.throws(() => registry.isInUse(1, 0));
});
