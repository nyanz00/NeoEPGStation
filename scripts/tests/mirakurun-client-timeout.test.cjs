const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadMirakurunClientModel() {
    const absolutePath = path.resolve(__dirname, '../..', 'src/model/MirakurunClientModel.ts');
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
        fileName: absolutePath,
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath) {
            if (request === 'inversify') return { inject: () => () => {}, injectable: () => target => target };
            if (request === 'mirakurun') return { __esModule: true, default: FakeMirakurunClient };
            if (
                request === './IConfigFile' ||
                request === './IConfiguration' ||
                request === './IMirakurunClientModel'
            ) {
                return {};
            }
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports.default;
}

class FakeMirakurunClient {
    basePath = '/api';
    docsPath = '/docs';
    host = '';
    port = 40772;
    socketPath = '/tmp/mirakurun.sock';
    userAgent = '';
    requests = [];
    calls = [];
    requestHandler = null;
    callHandler = null;

    request(method, requestPath, option) {
        this.requests.push({ method, requestPath, option });
        return this.requestHandler?.(method, requestPath, option) ?? Promise.resolve({ isSuccess: true });
    }

    call(operationId, param, option) {
        this.calls.push({ operationId, param, option });
        return this.callHandler?.(operationId, param, option) ?? Promise.resolve({});
    }
}

const MirakurunClientModel = loadMirakurunClientModel();

function createModel(timeoutMs = 30) {
    return new MirakurunClientModel({
        getConfig: () => ({ mirakurunPath: 'http://127.0.0.1:40772', tunerRequestTimeout: timeoutMs }),
    });
}

function waitForAbort(signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }
        signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
    });
}

test('applies tunerRequestTimeout to REST calls by aborting the underlying request', async () => {
    const client = createModel(25).getClient();
    client.callHandler = (_operationId, _param, option) => waitForAbort(option.signal);

    await assert.rejects(client.call('getPrograms'), { message: 'MirakurunRequestTimeout' });
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].option.signal.aborted, true);
});

test('applies timeout to direct REST request and preserves caller cancellation', async () => {
    const client = createModel(25).getClient();
    client.requestHandler = (_method, _path, option) => waitForAbort(option.signal);
    await assert.rejects(client.request('GET', '/test'), { message: 'MirakurunRequestTimeout' });
    assert.equal(client.requests[0].option.signal.aborted, true);

    const caller = new AbortController();
    const pending = client.request('GET', '/cancelled', { signal: caller.signal });
    const appliedSignal = client.requests[1].option.signal;
    caller.abort(new Error('caller cancelled'));
    await assert.rejects(pending, { message: 'caller cancelled' });
    assert.equal(appliedSignal.aborted, true);
});

test('does not start a request when the caller signal is already aborted', async () => {
    const client = createModel(25).getClient();
    const caller = new AbortController();
    caller.abort(new Error('already cancelled'));

    await assert.rejects(client.call('getPrograms', {}, { signal: caller.signal }), { message: 'already cancelled' });
    assert.equal(client.calls.length, 0);
});

test('clears the response-wait timeout once a stream response is acquired', async () => {
    const client = createModel(20).getClient();
    const streamResponse = new http.IncomingMessage(null);
    client.callHandler = async (_operationId, _param, option) => {
        client.streamSignal = option.signal;
        option.signal.addEventListener('abort', () => streamResponse.destroy(), { once: true });
        return streamResponse;
    };

    assert.equal(await client.call('getProgramStream'), streamResponse);
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(client.streamSignal.aborted, false);
    streamResponse.destroy();
});

test('forwards caller cancellation after stream headers until the stream closes', async () => {
    const client = createModel(100).getClient();
    const caller = new AbortController();
    const streamResponse = new http.IncomingMessage(null);
    client.callHandler = async (_operationId, _param, option) => {
        client.streamSignal = option.signal;
        option.signal.addEventListener('abort', () => streamResponse.destroy(), { once: true });
        return streamResponse;
    };

    const response = await client.call('getProgramStream', {}, { signal: caller.signal });
    const closed = new Promise(resolve => response.once('close', resolve));
    caller.abort(new Error('cancel after headers'));
    assert.equal(client.streamSignal.aborted, true);
    await closed;
    assert.equal(response.destroyed, true);
});

test('getClient applies the timeout wrapper only once', async () => {
    const model = createModel(30);
    const first = model.getClient();
    const second = model.getClient();
    first.callHandler = async () => 'ok';

    assert.equal(first, second);
    assert.equal(await second.call('getTuners'), 'ok');
    assert.equal(first.calls.length, 1);
});
