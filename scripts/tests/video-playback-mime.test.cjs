const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const express = require('express');
require('reflect-metadata');

const repoRoot = path.resolve(__dirname, '../..');

function createModel(VideoApiModel, filePath) {
    const model = Object.create(VideoApiModel.prototype);
    model.videoUtil = {
        getFullFilePathFromId: async () => filePath,
    };
    return model;
}

async function createTempFile(t, fileName, content) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-playback-mime-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, fileName);
    await fs.writeFile(filePath, content);
    return filePath;
}

function makeMp4Header() {
    const header = Buffer.alloc(24);
    header.writeUInt32BE(header.length, 0);
    header.write('ftyp', 4, 'ascii');
    header.write('isom', 8, 'ascii');
    header.writeUInt32BE(0, 12);
    header.write('isom', 16, 'ascii');
    header.write('iso2', 20, 'ascii');
    return header;
}

function makeMatroskaHeader() {
    return Buffer.concat([
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x8b, 0x42, 0x82, 0x88]),
        Buffer.from('matroska', 'ascii'),
    ]);
}

async function startServer(t, model, responseFile) {
    const app = express();
    const handles = [];
    app.all('/file', async (req, res, next) => {
        try {
            const info = await model.getFullFilePath(30166);
            if (info === null) {
                res.status(404).end();
                return;
            }
            handles.push(responseFile(req, res, info.path, info.mime));
        } catch (error) {
            next(error);
        }
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
        await Promise.all(handles.map(handle => handle.closed));
        await Promise.all(handles.map(handle => handle.stop()));
    });
    return `http://127.0.0.1:${address.port}/file`;
}

async function request(url, { method = 'GET', headers = {} } = {}) {
    const target = new URL(url);
    return new Promise((resolve, reject) => {
        const req = http.request(
            { hostname: target.hostname, port: target.port, path: target.pathname, method, headers },
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
}

test('compiled ESM VideoApiModel detects real MP4 and Matroska headers and keeps TS fallback', async t => {
    const { default: VideoApiModel } = await import(
        pathToFileURL(path.join(repoRoot, 'dist/model/api/video/VideoApiModel.js'))
    );
    const mp4Path = await createTempFile(t, 'sample.mp4', makeMp4Header());
    const matroskaPath = await createTempFile(t, 'sample.mkv', makeMatroskaHeader());
    const tsPath = await createTempFile(t, 'sample.ts', Buffer.from('unrecognized transport stream bytes'));

    assert.deepEqual(await createModel(VideoApiModel, mp4Path).getFullFilePath(30166), {
        path: mp4Path,
        mime: 'video/mp4',
    });
    assert.deepEqual(await createModel(VideoApiModel, matroskaPath).getFullFilePath(30166), {
        path: matroskaPath,
        mime: 'video/x-matroska',
    });
    assert.deepEqual(await createModel(VideoApiModel, tsPath).getFullFilePath(30166), {
        path: tsPath,
        mime: 'video/mp2t',
    });

    const missingModel = createModel(VideoApiModel, null);
    assert.equal(await missingModel.getFullFilePath(30166), null);
});

test('compiled ESM PLAY response serves the detected MIME and a one-byte range', async t => {
    const [{ default: VideoApiModel }, { responseFile }] = await Promise.all([
        import(pathToFileURL(path.join(repoRoot, 'dist/model/api/video/VideoApiModel.js'))),
        import(pathToFileURL(path.join(repoRoot, 'dist/model/service/api.js'))),
    ]);
    const filePath = await createTempFile(t, 'sample.mp4', makeMp4Header());
    const model = createModel(VideoApiModel, filePath);
    const url = await startServer(t, model, responseFile);

    const range = await request(url, { headers: { Range: 'bytes=0-0' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers['content-type'], 'video/mp4');
    assert.equal(range.headers['content-range'], `bytes 0-0/${(await fs.stat(filePath)).size}`);
    assert.equal(range.headers['content-length'], '1');
    assert.deepEqual(range.body, makeMp4Header().subarray(0, 1));

    const head = await request(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-type'], 'video/mp4');
    assert.equal(head.headers['content-length'], String((await fs.stat(filePath)).size));
    assert.equal(head.body.length, 0);
});
