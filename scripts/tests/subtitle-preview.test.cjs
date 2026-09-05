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

test('subtitle preview ranges survive the real OpenAPI middleware', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-subtitle-preview-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const logger = log4js.getLogger('subtitle-preview-test');
    logger.level = 'off';
    const calls = [];
    container.bind('IVideoApiModel').toConstantValue({
        getSubtitleText: async (video, subtitle, range) => {
            calls.push({ video, subtitle, range });
            return { subtitleText: '[Script Info]' };
        },
    });
    t.after(() => container.unbindAll());
    const service = new ServiceServer(
        { getLogger: () => ({ access: logger, system: logger }) },
        {
            getConfig: () => ({
                apiServers: ['http://localhost'],
                uploadTempDir: directory,
                thumbnail: directory,
                streamFilePath: directory,
            }),
        },
        { initialize: () => assert.fail('The application must not start') },
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
    const url = `http://127.0.0.1:${server.address().port}/api/videos/123/subtitles/2/text`;
    for (const [query, expected] of [
        ['?startAt=0&duration=210', { startAt: 0, duration: 210 }],
        ['?startAt=60.5&duration=210', { startAt: 60.5, duration: 210 }],
        ['?duration=210', { startAt: 0, duration: 210 }],
        ['', undefined],
    ]) {
        const response = await fetch(url + query);
        assert.equal(response.status, 200);
        await response.json();
        assert.deepEqual(calls.at(-1), { video: 123, subtitle: 2, range: expected });
    }
    const count = calls.length;
    for (const query of [
        '?startAt=-1&duration=210',
        '?startAt=invalid&duration=210',
        '?duration=0',
        '?duration=3601',
    ]) {
        const response = await fetch(url + query);
        assert.equal(response.status, 400);
        await response.text();
    }
    assert.equal(calls.length, count, 'invalid ranges must not reach extraction');
});
