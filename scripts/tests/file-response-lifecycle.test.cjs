const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const Module = require('node:module');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');
const express = require('express');

function loadTypeScript(relativePath) {
    const absolutePath = path.resolve(__dirname, relativePath);
    const source = require('node:fs').readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    loadedModule._compile(compiled, absolutePath);
    return loadedModule.exports;
}

const { responseFile } = loadTypeScript('../../src/model/service/api.ts');

async function createServer(t, { filePath, missingPath, onHandle = () => {}, unlinkAfterStart = false }) {
    const app = express();
    app.all('/file', (req, res) => {
        const handle = responseFile(req, res, filePath, 'video/mp2t');
        onHandle(handle);
        if (unlinkAfterStart) require('node:fs').unlinkSync(filePath);
    });
    app.get('/missing', (req, res) => responseFile(req, res, missingPath, 'video/mp2t'));
    app.use((error, _req, res, _next) => {
        res.status(404).end(error.code ?? 'error');
    });
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    t.after(async () => {
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
    });
    return `http://127.0.0.1:${address.port}`;
}

function request(origin, pathname = '/file', headers = {}) {
    const target = new URL(pathname, origin);
    const req = http.request({ hostname: target.hostname, port: target.port, path: target.pathname, headers });
    const response = new Promise((resolve, reject) => {
        req.once('response', res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
            res.once('error', reject);
        });
        req.once('error', reject);
    });
    req.end();
    return { req, response };
}

async function withTempFile(t, content) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'file-response-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'video.ts');
    await fs.writeFile(filePath, content);
    return { directory, filePath };
}

test('successful file response closes the source only after the body is sent', async t => {
    const { filePath } = await withTempFile(t, 'transport-stream-data');
    let handle;
    const origin = await createServer(t, { filePath, missingPath: filePath, onHandle: value => (handle = value) });
    const response = await request(origin).response;

    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'video/mp2t');
    assert.equal(response.headers['content-length'], String(Buffer.byteLength('transport-stream-data')));
    assert.equal(response.headers['accept-ranges'], 'bytes');
    assert.equal(response.body.toString(), 'transport-stream-data');
    await handle.closed;
    await handle.stop();
});

test('range response preserves status and bytes and HEAD and 416 settle without a readable', async t => {
    const { filePath } = await withTempFile(t, '0123456789');
    const handles = [];
    const origin = await createServer(t, { filePath, missingPath: filePath, onHandle: handle => handles.push(handle) });

    const range = await request(origin, '/file', { range: 'bytes=2-5' }).response;
    assert.equal(range.status, 206);
    assert.equal(range.headers['content-range'], 'bytes 2-5/10');
    assert.equal(range.headers['content-length'], '4');
    assert.equal(range.body.toString(), '2345');
    await handles[0].closed;

    const head = await new Promise((resolve, reject) => {
        const target = new URL('/file', origin);
        const req = http.request(
            { hostname: target.hostname, port: target.port, path: target.pathname, method: 'HEAD' },
            res => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () =>
                    resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
                );
                res.once('error', reject);
            },
        );
        req.once('error', reject);
        req.end();
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], '10');
    assert.equal(head.body.length, 0);
    await handles[1].closed;

    const unsatisfiable = await request(origin, '/file', { range: 'bytes=10-20' }).response;
    assert.equal(unsatisfiable.status, 416);
    assert.equal(unsatisfiable.headers['content-range'], 'bytes */10');
    assert.equal(unsatisfiable.body.length, 0);
    await handles[2].closed;
});

test('response close destroys and closes an interrupted file stream', async t => {
    const { filePath } = await withTempFile(t, Buffer.alloc(16 * 1024 * 1024, 0x61));
    let handle;
    const origin = await createServer(t, { filePath, missingPath: filePath, onHandle: value => (handle = value) });
    const { req, response } = request(origin);
    const earlyResponse = response.catch(() => null);
    await new Promise(resolve => req.once('response', resolve));
    req.destroy();
    await handle.closed;
    await earlyResponse;
    await fs.rm(filePath);
});

test('readable open failure destroys the response and still resolves close handle', async t => {
    const { filePath } = await withTempFile(t, 'will disappear before open');
    let resolveHandle;
    const handlePromise = new Promise(resolve => (resolveHandle = resolve));
    const origin = await createServer(t, {
        filePath,
        missingPath: filePath,
        onHandle: resolveHandle,
        unlinkAfterStart: true,
    });
    const result = request(origin).response.catch(() => null);
    const handle = await handlePromise;

    await handle.closed;
    assert.equal(await result, null);
});

test('missing files fail before a response stream handle is created', async t => {
    const { directory, filePath } = await withTempFile(t, 'present');
    let handle;
    const origin = await createServer(t, {
        filePath,
        missingPath: path.join(directory, 'missing.ts'),
        onHandle: value => (handle = value),
    });
    const response = await request(origin, '/missing').response;

    assert.equal(response.status, 404);
    assert.equal(handle, undefined);
});
