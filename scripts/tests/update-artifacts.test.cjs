const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '../..');

function loadUpdateArtifacts() {
    const filename = path.join(repoRoot, 'src/model/update/UpdateArtifacts.ts');
    const output = ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
        fileName: filename,
    }).outputText;
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    loaded._compile(output, filename);
    return loaded.exports;
}

const { captureUpdateArtifacts, restoreUpdateArtifacts } = loadUpdateArtifacts();

async function makeTemporaryRoot(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neo-update-artifacts-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

async function writeFixture(root, { omit } = {}) {
    const files = {
        'dist/index.js': 'server-entry-original',
        'dist/chunks/runtime.js': 'server-runtime-original',
        'client/dist/index.html': 'client-entry-original',
        'client/dist/assets/app.js': 'client-app-original',
        'client/dist/assets/app.css': 'client-css-original',
    };
    for (const [relativePath, contents] of Object.entries(files)) {
        if (relativePath === omit) continue;
        const filePath = path.join(root, relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, contents);
    }
}

async function listFiles(root, relativePath = '') {
    const directory = path.join(root, relativePath);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = {};
    for (const entry of entries) {
        const childPath = path.join(relativePath, entry.name);
        if (entry.isDirectory()) Object.assign(files, await listFiles(root, childPath));
        else files[childPath.replaceAll(path.sep, '/')] = await fs.readFile(path.join(root, childPath), 'utf8');
    }
    return files;
}

test('restores damaged and missing server/client outputs, including nested assets', async t => {
    const temporaryRoot = await makeTemporaryRoot(t);
    const root = path.join(temporaryRoot, 'application');
    const snapshot = path.join(temporaryRoot, 'snapshot');
    await writeFixture(root);
    await fs.mkdir(snapshot, { recursive: true });
    await captureUpdateArtifacts(root, snapshot);

    await fs.rm(path.join(root, 'dist'), { recursive: true, force: true });
    await fs.writeFile(path.join(root, 'client/dist/index.html'), 'broken-client-entry');
    await fs.rm(path.join(root, 'client/dist/assets'), { recursive: true, force: true });
    await fs.mkdir(path.join(root, 'client/dist/assets'), { recursive: true });
    await fs.writeFile(path.join(root, 'client/dist/assets/corrupt.js'), 'corrupt');

    await restoreUpdateArtifacts(root, snapshot);
    assert.deepEqual(await listFiles(root), await listFiles(snapshot));
});

test('rejects an incomplete snapshot without changing the current outputs', async t => {
    const temporaryRoot = await makeTemporaryRoot(t);
    const root = path.join(temporaryRoot, 'application');
    const snapshot = path.join(temporaryRoot, 'incomplete-snapshot');
    await writeFixture(root);
    await writeFixture(snapshot, { omit: 'client/dist/index.html' });
    const before = await listFiles(root);

    await assert.rejects(restoreUpdateArtifacts(root, snapshot), { code: 'ENOENT' });
    assert.deepEqual(await listFiles(root), before);
});

test('refuses to capture outputs when either required entry file is missing', async t => {
    const temporaryRoot = await makeTemporaryRoot(t);
    for (const missingEntry of ['dist/index.js', 'client/dist/index.html']) {
        const root = path.join(temporaryRoot, `application-${missingEntry.startsWith('dist/') ? 'server' : 'client'}`);
        const snapshot = path.join(temporaryRoot, `snapshot-${path.basename(root)}`);
        await writeFixture(root, { omit: missingEntry });
        await fs.mkdir(snapshot, { recursive: true });

        await assert.rejects(captureUpdateArtifacts(root, snapshot), { code: 'ENOENT' });
        assert.deepEqual(await fs.readdir(snapshot), []);
    }
});
