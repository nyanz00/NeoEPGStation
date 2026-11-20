'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
        fileName: filename,
    }).outputText;
    module._compile(output, filename);
};

const { default: TunerServerAccessModel } = require('../../src/model/tuner/TunerServerAccessModel.ts');
const { parseConnectionTarget } = require('../../src/model/tuner/transport/ConnectionTargetParser.ts');

async function listen(t, handler) {
    const server = http.createServer(handler);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    const address = server.address();
    return { server, port: address.port, url: `http://127.0.0.1:${address.port}` };
}

function respondJson(response, statusCode, value) {
    response.writeHead(statusCode, { 'Content-Type': 'application/json' });
    response.end(typeof value === 'string' ? value : JSON.stringify(value));
}

test('parses HTTP base paths, both Unix URL forms, and Windows named pipes', () => {
    assert.deepEqual(parseConnectionTarget('http://localhost:40772/tuner/base/../api-root'), {
        kind: 'http',
        host: 'localhost',
        port: 40772,
        basePath: '/tuner/api-root',
    });
    assert.deepEqual(parseConnectionTarget('http+unix://%2Ftmp%2Ftuner.sock/prefix'), {
        kind: 'unix',
        socketPath: '/tmp/tuner.sock',
        basePath: '/prefix',
    });
    assert.deepEqual(parseConnectionTarget('http://unix:/tmp/tuner.sock:/legacy'), {
        kind: 'unix',
        socketPath: '/tmp/tuner.sock',
        basePath: '/legacy',
    });
    assert.deepEqual(parseConnectionTarget('\\\\.\\pipe\\mirakurun'), {
        kind: 'named-pipe',
        socketPath: '\\\\.\\pipe\\mirakurun',
        basePath: '',
    });
});

test('returns full status and tuner metadata through the HTTP boundary', async t => {
    const status = {
        time: 1_800_000_000_000,
        version: '4.1.3-nyanz.1',
        process: { arch: 'x64', platform: 'win32', pid: 2468, memoryUsage: { rss: 1234 } },
        epg: { gatheringNetworks: [1, 2], storedEvents: 98765 },
        rpcCount: 12,
        streamCount: { tunerDevice: 1, tsFilter: 2, decoder: 3 },
        errorCount: {
            uncaughtException: 4,
            unhandledRejection: 5,
            bufferOverflow: 6,
            tunerDeviceRespawn: 7,
            decoderRespawn: 8,
        },
        timerAccuracy: {
            last: 9,
            m1: { avg: 1, min: 0, max: 2 },
            m5: { avg: 2, min: 1, max: 3 },
            m15: { avg: 3, min: 2, max: 4 },
        },
    };
    const tuner = {
        index: 0,
        name: 'チューナーA',
        types: ['GR', 'BS'],
        command: 'BonDriver',
        pid: 4321,
        users: [
            {
                id: 'stream-1',
                priority: 17,
                agent: 'EPGStation/1.0',
                url: '/api/services/101/stream',
                streamInfo: { '0x100': { packet: 10, drop: 2 } },
            },
        ],
        isAvailable: true,
        isRemote: false,
        isFree: false,
        isUsing: true,
        isFault: false,
    };
    const seen = [];
    const { url } = await listen(t, (request, response) => {
        seen.push({ url: request.url, userAgent: request.headers['user-agent'] });
        if (request.url === '/tuner/api/status') return respondJson(response, 200, status);
        if (request.url === '/tuner/api/tuners') return respondJson(response, 200, [tuner]);
        respondJson(response, 404, { error: 'not found' });
    });
    const access = new TunerServerAccessModel(`${url}/tuner`, 'NeoEPGStation-test');

    assert.deepEqual(await access.getStatus(), status);
    assert.deepEqual(await access.getTuners(), [tuner]);
    assert.deepEqual(
        seen.map(item => item.url),
        ['/tuner/api/status', '/tuner/api/tuners'],
    );
    assert.ok(seen.every(item => item.userAgent === 'NeoEPGStation-test'));
});

test('opens priority/decode streams, sends Connection: close, and uses a fresh socket afterwards', async t => {
    const requests = [];
    const { url } = await listen(t, (request, response) => {
        requests.push({
            url: request.url,
            priority: request.headers['x-mirakurun-priority'],
            connection: request.headers.connection,
            socket: request.socket,
        });
        if (request.url?.startsWith('/base/api/') && request.url.includes('/stream?')) {
            response.writeHead(200, { 'Content-Type': 'video/MP2T' });
            response.write(Buffer.from([0x47, 0x00, 0x01]));
            return;
        }
        if (request.url === '/base/api/status') return respondJson(response, 200, { ok: true });
        respondJson(response, 404, { error: 'not found' });
    });
    const access = new TunerServerAccessModel(`${url}/base`, 'test-agent');

    const program = await access.getProgramStream({ id: 42, priority: 31 });
    assert.equal(program.readable, true);
    assert.equal(requests[0].url, '/base/api/programs/42/stream?decode=1');
    assert.equal(requests[0].priority, '31');
    assert.equal(requests[0].connection, 'close');
    const firstSocket = requests[0].socket;
    const programClosed = new Promise(resolve => program.once('close', resolve));
    program.destroy();
    await programClosed;

    const service = await access.getServiceStream({ id: 99, decode: false, priority: 7 });
    assert.equal(service.readable, true);
    assert.equal(requests[1].url, '/base/api/services/99/stream?decode=0');
    assert.equal(requests[1].priority, '7');
    assert.equal(requests[1].connection, 'close');
    const serviceClosed = new Promise(resolve => service.once('close', resolve));
    service.destroy();
    await serviceClosed;

    await access.getStatus();
    assert.equal(requests[2].url, '/base/api/status');
    assert.notEqual(requests[2].socket, firstSocket);
});

test('aborts an acquired stream when its caller signal is cancelled', async t => {
    let requestClosed;
    const closed = new Promise(resolve => {
        requestClosed = resolve;
    });
    const { url } = await listen(t, (request, response) => {
        request.socket.once('close', requestClosed);
        response.writeHead(200, { 'Content-Type': 'video/MP2T' });
        response.write(Buffer.from([0x47, 0x00, 0x01]));
    });
    const access = new TunerServerAccessModel(url, 'test-agent', 30);
    const controller = new AbortController();
    const stream = await access.getServiceStream({ id: 1, signal: controller.signal });
    const streamClosed = new Promise(resolve => stream.once('close', resolve));
    await new Promise(resolve => setTimeout(resolve, 45));
    assert.equal(stream.destroyed, false, 'stream establishment timeout must not terminate an acquired stream');

    controller.abort(new Error('caller cancelled'));
    await streamClosed;
    await closed;
    assert.equal(stream.destroyed, true);
});

test('aborts a stalled metadata request at the configured timeout', async t => {
    let requestClosed;
    const closed = new Promise(resolve => {
        requestClosed = resolve;
    });
    const { url } = await listen(t, request => {
        request.socket.once('close', requestClosed);
    });
    const access = new TunerServerAccessModel(url, 'test-agent', 25);

    await assert.rejects(access.getStatus());
    await closed;
});

test('rejects malformed JSON responses', async t => {
    const { url } = await listen(t, (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"epg":');
    });
    const access = new TunerServerAccessModel(url, 'test-agent');

    await assert.rejects(access.getStatus(), { message: 'Invalid tuner JSON response' });
});

test('detects mirakc only from a missing server config endpoint', async t => {
    let statusCode = 404;
    const { url } = await listen(t, (_request, response) => {
        respondJson(response, statusCode, { error: 'config endpoint response' });
    });
    const access = new TunerServerAccessModel(url, 'test-agent');

    assert.equal(await access.isMirakc(), true);
    statusCode = 200;
    assert.equal(await access.isMirakc(), false);
    statusCode = 503;
    await assert.rejects(access.isMirakc(), { message: 'Tuner request failed with status 503' });
});

test('follows one absolute-path redirect without duplicating basePath, then rejects another redirect', async t => {
    const requests = [];
    const { url } = await listen(t, (request, response) => {
        requests.push(request.url);
        if (request.url === '/base/api/status') {
            response.writeHead(302, { Location: '/base/status-final' });
            response.end();
            return;
        }
        if (request.url === '/base/status-final') return respondJson(response, 200, { redirected: true });
        if (request.url === '/base/api/tuners') {
            response.writeHead(302, { Location: '/base/tuners-redirected' });
            response.end();
            return;
        }
        if (request.url === '/base/tuners-redirected') {
            response.writeHead(302, { Location: '/base/third-hop' });
            response.end();
            return;
        }
        respondJson(response, 404, { error: 'not found' });
    });
    const access = new TunerServerAccessModel(`${url}/base`, 'test-agent');

    assert.deepEqual(await access.getStatus(), { redirected: true });
    assert.deepEqual(requests, ['/base/api/status', '/base/status-final']);
    await assert.rejects(access.getTuners(), { message: 'Too many tuner redirects' });
    assert.deepEqual(requests.slice(2), ['/base/api/tuners', '/base/tuners-redirected']);
});

test('keeps the configured basePath for mirakc events and aborts the acquired stream', async t => {
    let requestUrl;
    let requestClosedResolve;
    const requestClosed = new Promise(resolve => { requestClosedResolve = resolve; });
    const { url } = await listen(t, (request, response) => {
        requestUrl = request.url;
        request.socket.once('close', requestClosedResolve);
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('event: update\ndata: {}\n\n');
    });
    const access = new TunerServerAccessModel(`${url}/proxy`, 'test-agent');
    const controller = new AbortController();
    const events = await access.getMirakcEvents(controller.signal);
    const streamClosed = new Promise(resolve => events.once('close', resolve));

    assert.equal(requestUrl, '/proxy/events');
    controller.abort(new Error('stop event feed'));
    await Promise.all([streamClosed, requestClosed]);
    assert.equal(events.destroyed, true);
});
