const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
require('reflect-metadata');
const log4js = require('log4js');
const ServiceServer = require('../../dist/model/service/ServiceServer').default;
const container = require('../../dist/model/ModelContainer').default;

// Exercise the real route modules and OpenAPI middleware without starting DB,
// recording, encoding, external integrations or the application's entry point.
for (const prefix of ['', '/neo']) {
    test(`Express 5 API and static integration (${prefix || '/'})`, async t => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-express5-'));
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        const logger = log4js.getLogger('express5-test');
        logger.level = 'off';
        let uploaded;
        container.unbindAll();
        container.bind('IRecordedApiModel').toConstantValue({
            gets: async option => option,
            addUploadedVideoFile: async option => {
                uploaded = option;
            },
        });
        container.bind('IRecordedTagApiModel').toConstantValue({
            create: async (name, color) => {
                assert.equal(name, 'tag');
                assert.equal(color, '#fff');
                return 42;
            },
        });
        container.bind('IRecordedPlaybackApiModel').toConstantValue({ get: async (id, user) => ({ id, user }) });
        container
            .bind('IVideoApiModel')
            .toConstantValue({ prepareSubtitle: async (video, subtitle) => ({ video, subtitle }) });
        const service = new ServiceServer(
            { getLogger: () => ({ access: logger, system: logger }) },
            {
                getConfig: () => ({
                    apiServers: ['http://localhost'],
                    subDirectory: prefix || undefined,
                    uploadTempDir: path.join(directory, 'upload'),
                    thumbnail: directory,
                    streamFilePath: directory,
                    isAllowAllCORS: true,
                }),
            },
            {
                initialize: () => {
                    throw new Error('Socket.IO must not start in this test');
                },
            },
        );
        await service.apiInitialization;
        const server = service.app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        t.after(
            () =>
                new Promise(resolve => {
                    server.close(resolve);
                    server.closeAllConnections();
                }),
        );
        const base = `http://127.0.0.1:${server.address().port}${prefix}`;
        const request = (url, options) => fetch(base + url, options);

        await t.test('all existing documented operations register, including Neo routes', async () => {
            const response = await request('/api/docs');
            assert.equal(response.status, 200);
            const doc = await response.json();
            let operations = 0;
            for (const route of service.getApiRoutes(ServiceServer.API_DIR)) {
                for (const method of ['get', 'post', 'put', 'delete', 'patch', 'head', 'options']) {
                    if (!route.module[method]?.apiDoc) continue;
                    assert.ok(doc.paths[route.path]?.[method], `${method} ${route.path}`);
                    operations++;
                }
            }
            assert.ok(operations > 100);
            t.diagnostic(`${operations} operations registered`);
            for (const route of [
                '/recorded/{recordedId}/playback',
                '/viewer-profiles',
                '/videos/{videoFileId}/subtitles/{subtitleIndex}/prepare',
            ]) {
                assert.ok(doc.paths[route], route);
            }
        });

        await t.test('boolean, numeric and array query parameters reach the model intact', async () => {
            const response = await request(
                '/api/recorded?isHalfWidth=false&isReverse=false&limit=12&offset=2&hasOriginalFile=false&hasDrop=true&encodeModes[]=a&encodeModes[]=b',
            );
            assert.equal(response.status, 200);
            const result = await response.json();
            assert.equal(result.isHalfWidth, false);
            assert.equal(result.isReverse, false);
            assert.equal(result.hasOriginalFile, false);
            assert.equal(result.hasDrop, true);
            assert.equal(result.limit, 12);
            assert.equal(result.offset, 2);
            assert.deepEqual(result.encodeModes, ['a', 'b']);
            const defaults = await (await request('/api/recorded?isHalfWidth=true')).json();
            assert.equal(defaults.isHalfWidth, true);
            assert.equal(defaults.offset, 0);
            assert.equal(defaults.limit, 24);
            assert.equal((await request('/api/recorded')).status, 400);
            assert.equal((await request('/api/recorded?isHalfWidth=true&limit=invalid')).status, 400);
        });

        await t.test('Neo nested path parameters and active user headers', async () => {
            let response = await request('/api/recorded/123/playback', { headers: { 'x-epgstation-user-id': '7' } });
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), { id: 123, user: 7 });
            response = await request('/api/videos/123/subtitles/2/prepare', { method: 'POST' });
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), { video: 123, subtitle: 2 });
            assert.equal((await request('/api/recorded/invalid/playback')).status, 400);
        });

        await t.test('JSON body parsing, schema errors and malformed JSON', async () => {
            const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
            let response = await request('/api/tags', {
                ...options,
                body: JSON.stringify({ name: 'tag', color: '#fff' }),
            });
            assert.equal(response.status, 201);
            assert.deepEqual(await response.json(), { tagId: 42 });
            for (const body of ['{}', '{invalid', '']) {
                response = await request('/api/tags', { ...options, body });
                assert.equal(response.status, 400);
            }
        });

        await t.test('multipart upload preserves fields and temporary file', async () => {
            const form = new FormData();
            for (const [key, value] of Object.entries({
                recordedId: '123',
                parentDirectoryName: 'recorded',
                viewName: 'test',
                fileType: 'encoded',
            }))
                form.set(key, value);
            form.set('file', new Blob(['test video']), 'test.mp4');
            const response = await request('/api/videos/upload', { method: 'POST', body: form });
            assert.equal(response.status, 200, await response.text());
            assert.equal(uploaded.recordedId, 123);
            assert.equal(uploaded.fileName, 'test.mp4');
            assert.equal(fs.readFileSync(uploaded.filePath, 'utf8'), 'test video');
        });

        await t.test('static MIME types, range and HEAD responses', async () => {
            const types = {
                ts: 'video/mpeg',
                m3u8: 'application/vnd.apple.mpegurl',
                m4s: 'application/octet-stream',
                log: 'text/plain',
                js: 'text/javascript',
                css: 'text/css',
                woff2: 'font/woff2',
            };
            for (const [extension, type] of Object.entries(types)) {
                fs.writeFileSync(path.join(directory, `test.${extension}`), '0123456789');
                const response = await request(`/streamfiles/test.${extension}`);
                assert.equal(response.status, 200);
                assert.equal(response.headers.get('content-type').split(';')[0], type);
            }
            let response = await request('/streamfiles/test.ts', { headers: { Range: 'bytes=2-4' } });
            assert.equal(response.status, 206);
            assert.equal(response.headers.get('content-range'), 'bytes 2-4/10');
            assert.equal(await response.text(), '234');
            response = await request('/streamfiles/test.ts', { method: 'HEAD' });
            assert.equal(response.status, 200);
            assert.equal(response.headers.get('content-length'), '10');
            assert.equal(await response.text(), '');
        });

        await t.test('CORS, Swagger redirect and unknown routes', async () => {
            const response = await request('/api/recorded', {
                method: 'OPTIONS',
                headers: { Origin: 'http://example.test', 'Access-Control-Request-Method': 'GET' },
            });
            assert.equal(response.status, 204);
            assert.equal(response.headers.get('access-control-allow-origin'), '*');
            const redirect = await request('/api/debug', { redirect: 'manual' });
            assert.equal(redirect.status, 302);
            const location = new URL(redirect.headers.get('location'), base);
            assert.equal(location.pathname.replace(/\/$/, ''), `${prefix}/api-docs`);
            assert.equal(location.searchParams.get('url'), `${prefix}/api/docs`);
            assert.equal((await request('/api/does-not-exist')).status, 404);
        });
    });
}
