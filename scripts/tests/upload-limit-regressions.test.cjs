const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/service/upload/UploadAdmissionController.ts');
const source = require('node:fs').readFileSync(sourcePath, 'utf8');
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

const { IncomingUploadFile } = loadedModule.exports;
const UploadAdmissionController = loadedModule.exports.default;

test('upload admission enforces the configured concurrent receiver limit and releases once', () => {
    const admission = new UploadAdmissionController(3);
    const leases = [admission.tryAcquire(), admission.tryAcquire(), admission.tryAcquire()];
    assert.ok(leases.every(lease => lease !== null));
    assert.equal(admission.tryAcquire(), null);

    leases[0].releaseOnce();
    leases[0].releaseOnce();
    const replacement = admission.tryAcquire();
    assert.ok(replacement !== null);
    assert.equal(admission.tryAcquire(), null);
    leases[1].releaseOnce();
    leases[2].releaseOnce();
    replacement.releaseOnce();
    assert.ok(admission.tryAcquire() !== null);
});

test('failed or timed-out upload cleanup removes only its partial payload and owned directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-cleanup-test-'));
    const tokenDirectory = path.join(root, 'incoming', 'upload-owned');
    const unrelated = path.join(root, 'incoming', 'keep.txt');
    await fs.mkdir(tokenDirectory, { recursive: true });
    await fs.writeFile(path.join(tokenDirectory, 'payload'), 'partial upload');
    await fs.writeFile(unrelated, 'keep');
    const errors = [];
    const incoming = new IncomingUploadFile(tokenDirectory, path.join(tokenDirectory, 'payload'), {
        error: message => errors.push(message),
    });

    await incoming.cleanupOnce();
    await incoming.cleanupOnce();

    await assert.rejects(fs.stat(tokenDirectory), { code: 'ENOENT' });
    assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep');
    assert.deepEqual(errors, []);
    await fs.rm(root, { recursive: true, force: true });
});

test('incoming upload rejects payload paths outside the owned token directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-path-test-'));
    const ownedDirectory = path.join(root, 'token');
    assert.throws(
        () => new IncomingUploadFile(ownedDirectory, path.join(root, 'sibling-payload'), { error() {} }),
        /UploadPayloadOutsideOwnedDirectory/,
    );
    await fs.rm(root, { recursive: true, force: true });
});

test('cleanup preserves unowned files inside the token directory instead of deleting recursively', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-preserve-test-'));
    const tokenDirectory = path.join(root, 'token');
    const payload = path.join(tokenDirectory, 'payload');
    const unrelated = path.join(tokenDirectory, 'unrelated.txt');
    await fs.mkdir(tokenDirectory);
    await fs.writeFile(payload, 'partial');
    await fs.writeFile(unrelated, 'keep');
    const incoming = new IncomingUploadFile(tokenDirectory, payload, { error: assert.fail });

    await incoming.cleanupOnce();

    await assert.rejects(fs.stat(payload), { code: 'ENOENT' });
    assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep');
    await fs.rm(root, { recursive: true, force: true });
});

test('cleanup failure is reported and a later cleanup attempt can retry', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-retry-test-'));
    const tokenDirectory = path.join(root, 'token');
    const payload = path.join(tokenDirectory, 'payload');
    await fs.mkdir(payload, { recursive: true });
    const errors = [];
    const incoming = new IncomingUploadFile(tokenDirectory, payload, { error: error => errors.push(error) });

    await assert.rejects(incoming.cleanupOnce());
    assert.equal(errors.length, 1);
    await fs.rmdir(payload);
    await fs.writeFile(payload, 'partial');
    await incoming.cleanupOnce();

    await assert.rejects(fs.stat(tokenDirectory), { code: 'ENOENT' });
    await fs.rm(root, { recursive: true, force: true });
});
