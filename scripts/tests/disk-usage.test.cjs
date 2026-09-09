const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
require('reflect-metadata');
const { getDiskUsage } = require('../../dist/util/DiskUsage');
const StorageApiModel = require('../../dist/model/api/storage/StorageApiModel').default;
const StorageManageModel = require('../../dist/model/operator/storage/StorageManageModel').default;

test('capacity display and monitoring use available blocks, excluding reserved space', async t => {
    const input = '\\\\server\\share\\録画 フォルダ';
    t.mock.method(fs, 'statfs', async value => {
        assert.equal(value, input);
        return { bsize: 4096, blocks: 100, bfree: 30, bavail: 20 };
    });
    assert.deepEqual(await StorageApiModel.prototype.getDiskInfo(input), {
        total: 409600,
        used: 286720,
        available: 81920,
    });
    assert.equal(await StorageManageModel.prototype.getFreeSize(input), 81920);
});

test('filesystem errors propagate instead of reporting zero free space', async t => {
    const error = Object.assign(new Error('access denied'), { code: 'EACCES' });
    t.mock.method(fs, 'statfs', async () => {
        throw error;
    });
    await assert.rejects(StorageApiModel.prototype.getDiskInfo('missing'), error);
    await assert.rejects(StorageManageModel.prototype.getFreeSize('missing'), error);
});

test('real filesystem capacity works without WMIC or other child processes', async t => {
    const cp = require('node:child_process');
    for (const method of ['exec', 'execFile', 'spawn']) {
        t.mock.method(cp, method, () => assert.fail('No external command should be executed'));
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-disk-'));
    t.after(() => fs.rmdir(directory));
    const usage = await getDiskUsage(directory);
    assert.ok(usage.total > 0);
    assert.ok(usage.available >= 0 && usage.available <= usage.total);
    assert.ok(usage.used >= 0 && usage.used <= usage.total);
});
