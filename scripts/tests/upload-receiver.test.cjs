const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');
const express = require('express');

function withTypeScriptLoader(callback) {
    const previousTsLoader = require.extensions['.ts'];
    require.extensions['.ts'] = (loadedModule, filename) => {
        const source = require('node:fs').readFileSync(filename, 'utf8');
        const compiled = ts.transpileModule(source, {
            compilerOptions: {
                esModuleInterop: true,
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2021,
            },
        }).outputText;
        loadedModule._compile(compiled, filename);
    };
    try {
        return callback();
    } finally {
        if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
        else delete require.extensions['.ts'];
    }
}

const { receiveUpload } = withTypeScriptLoader(() =>
    require(path.resolve(__dirname, '../../src/model/service/upload/receiveUpload.ts')),
);
const UploadAdmissionController = withTypeScriptLoader(
    () => require(path.resolve(__dirname, '../../src/model/service/upload/UploadAdmissionController.ts')).default,
);

async function createUploadServer({ maxConcurrent = 2, timeout = 2_000, handoff } = {}) {
    const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-receiver-test-'));
    const app = express();
    const admission = new UploadAdmissionController(maxConcurrent);
    const logs = [];
    const options = { directory: uploadRoot, timeout, admission, log: { error: message => logs.push(message) } };

    app.post(
        '/upload',
        (req, res, next) => receiveUpload(req, res, next, options),
        async (req, res) => {
            const file = req.file;
            if (file === undefined) {
                res.status(400).json({ error: 'missing file' });
                return;
            }
            if (handoff !== undefined) {
                handoff.received({ path: file.path, cleanup: req.cleanupIncomingUpload });
                try {
                    await handoff.wait;
                } finally {
                    await req.cleanupIncomingUpload?.();
                    handoff.cleaned();
                }
                if (!res.destroyed) res.status(200).json({ ok: true });
                return;
            }

            const response = {
                path: file.path,
                filename: file.filename,
                recordedId: req.body.recordedId,
                contents: await fs.readFile(file.path, 'utf8'),
            };
            await req.cleanupIncomingUpload?.();
            res.status(200).json(response);
        },
    );

    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    return {
        uploadRoot,
        incomingRoot: path.join(uploadRoot, 'incoming'),
        logs,
        origin: `http://127.0.0.1:${address.port}`,
        async close() {
            server.closeAllConnections?.();
            await new Promise(resolve => server.close(resolve));
            await fs.rm(uploadRoot, { recursive: true, force: true });
        },
    };
}

function openMultipart(origin, { fieldName = 'file', fileName = 'capture.ts' } = {}) {
    const boundary = `----neo-upload-${Math.random().toString(16).slice(2)}`;
    const target = new URL('/upload', origin);
    const request = http.request({
        hostname: target.hostname,
        port: target.port,
        method: 'POST',
        path: target.pathname,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    const result = new Promise((resolve, reject) => {
        request.once('response', response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                let body;
                try {
                    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                } catch {
                    body = Buffer.concat(chunks).toString('utf8');
                }
                resolve({ status: response.statusCode, body });
            });
        });
        request.once('error', reject);
    });
    request.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="recordedId"\r\n\r\n42\r\n--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
            'Content-Type: application/octet-stream\r\n\r\n',
    );
    return {
        request,
        result,
        write: chunk => request.write(chunk),
        end: () => request.end(`\r\n--${boundary}--\r\n`),
    };
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForEmptyDirectory(directory, timeout = 1_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            if ((await fs.readdir(directory)).length === 0) return;
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        await delay(10);
    }
    assert.fail(`upload temp directory was not cleaned: ${directory}`);
}

async function waitForPartialPayload(directory, timeout = 1_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            for (const token of await fs.readdir(directory)) {
                const payload = path.join(directory, token, 'payload');
                const stat = await fs.stat(payload).catch(() => null);
                if (stat?.isFile() && stat.size > 0) return payload;
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        await delay(5);
    }
    assert.fail(`partial upload payload was not created in ${directory}`);
}

test('successful multipart request stores file at req.file.path and route cleanup removes it', async t => {
    const server = await createUploadServer();
    t.after(() => server.close());
    const multipart = openMultipart(server.origin);
    multipart.write('a small upload');
    multipart.end();
    const response = await multipart.result;

    assert.equal(response.status, 200);
    assert.equal(response.body.recordedId, 42);
    assert.equal(response.body.filename, 'payload');
    assert.equal(await fs.readFile(response.body.path, 'utf8').catch(error => error.code), 'ENOENT');
    await waitForEmptyDirectory(server.incomingRoot);
});

test('receiver admission rejects a concurrent second upload with 503', async t => {
    const server = await createUploadServer({ maxConcurrent: 1, timeout: 2_000 });
    t.after(() => server.close());
    const first = openMultipart(server.origin);
    first.write('first partial upload');
    await waitForPartialPayload(server.incomingRoot);
    const second = openMultipart(server.origin);
    second.write('second upload');
    second.end();

    const rejected = await second.result;
    assert.equal(rejected.status, 503);
    first.end();
    assert.equal((await first.result).status, 200);
    await waitForEmptyDirectory(server.incomingRoot);
});

test('receive timeout returns 408 and deletes a partial payload and token directory', async t => {
    const server = await createUploadServer({ timeout: 40 });
    t.after(() => server.close());
    const multipart = openMultipart(server.origin);
    multipart.write('partial bytes before timeout');
    await waitForPartialPayload(server.incomingRoot);
    const response = await multipart.result;
    multipart.request.destroy();

    assert.equal(response.status, 408);
    assert.equal(response.body.message, 'UploadReceiveTimeout');
    await waitForEmptyDirectory(server.incomingRoot);
});

test('client abort cleans the partial upload and releases the admission slot', async t => {
    const server = await createUploadServer({ maxConcurrent: 1, timeout: 2_000 });
    t.after(() => server.close());
    const aborted = openMultipart(server.origin);
    aborted.write('partial bytes before client abort');
    await waitForPartialPayload(server.incomingRoot);
    const abortedResult = aborted.result.catch(() => null);
    aborted.request.destroy();
    await abortedResult;
    await waitForEmptyDirectory(server.incomingRoot);

    const next = openMultipart(server.origin);
    next.write('next successful upload');
    next.end();
    assert.equal((await next.result).status, 200);
    await waitForEmptyDirectory(server.incomingRoot);
});

test('successful receive hands ownership to the route until its final cleanup', async t => {
    let markReceived;
    let finishRoute;
    let unblockRoute;
    const received = new Promise(resolve => (markReceived = resolve));
    const routeFinished = new Promise(resolve => (finishRoute = resolve));
    const routeWait = new Promise(resolve => (unblockRoute = resolve));
    const server = await createUploadServer({
        handoff: {
            received: markReceived,
            cleaned: finishRoute,
            wait: routeWait,
        },
    });
    t.after(() => server.close());
    const multipart = openMultipart(server.origin);
    multipart.write('registration is still processing');
    multipart.end();
    const owned = await received;
    const disconnectedResult = multipart.result.catch(() => null);
    multipart.request.destroy();
    await disconnectedResult;
    await delay(30);
    assert.equal(await fs.readFile(owned.path, 'utf8'), 'registration is still processing');

    unblockRoute();
    await routeFinished;
    await assert.rejects(fs.stat(owned.path), { code: 'ENOENT' });
    await waitForEmptyDirectory(server.incomingRoot);
});
