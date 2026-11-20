const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');
const { QueryClient } = require('../../client/node_modules/@tanstack/react-query');
require('reflect-metadata');

function loadSource(relative, imports = {}) {
    const filename = path.resolve(__dirname, '../..', relative);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
        },
        fileName: filename,
    }).outputText;
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = loaded.require.bind(loaded);
    loaded.require = name => {
        if (Object.hasOwn(imports, name)) return imports[name];
        // Isolated TS transpilation cannot erase decorator metadata imports of
        // interfaces. These tests inject their dependencies without the container.
        if (relative.startsWith('src/') && name.startsWith('.')) return {};
        return original(name);
    };
    loaded._compile(compiled, filename);
    return loaded.exports;
}

test('server status and encode notifications stay separate from scoped history updates', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const SocketIOManageModel = loadSource('src/model/service/socketio/SocketIOManageModel.ts').default;
    const model = new SocketIOManageModel({ getLogger: () => ({}) }, { getConfig: () => ({}) });
    const events = [];
    model.ios = [{ sockets: { emit: (name, update) => events.push({ name, update }) } }];

    model.notifyClient();
    t.mock.timers.tick(200);
    assert.deepEqual(
        events.map(event => event.name),
        ['updateStatus'],
    );
    events.length = 0;
    model.notifyUpdateEncodeProgress();
    t.mock.timers.tick(200);
    assert.deepEqual(
        events.map(event => event.name),
        ['updateEncode'],
    );
    events.length = 0;

    model.notifyClient(42);
    model.notifyClient(42);
    model.notifyClient(7);
    t.mock.timers.tick(200);
    assert.deepEqual(events, [
        { name: 'updateStatus', update: undefined },
        { name: 'updateRecordedPlaybackHistory', update: { recordedIds: [42, 7] } },
    ]);
    events.length = 0;
    model.notifyClient();
    t.mock.timers.tick(200);
    assert.deepEqual(
        events.map(event => event.name),
        ['updateStatus'],
        'record IDs do not leak into the next batch',
    );

    events.length = 0;
    model.notifyRecordedPlaybackHistory(7);
    model.notifyRecordedPlaybackHistory(9, true);
    assert.deepEqual(events, [
        { name: 'updateRecordedPlaybackHistory', update: { userId: 7, settings: false } },
        { name: 'updateRecordedPlaybackHistory', update: { userId: 9, settings: true } },
    ]);
});

test('recorded IDs survive operator-to-service IPC without widening generic updates', t => {
    const IPCServer = loadSource('src/model/ipc/IPCServer.ts').default;
    const IPCClient = loadSource('src/model/ipc/IPCClient.ts').default;
    const parent = Object.create(IPCServer.prototype);
    const child = Object.create(IPCClient.prototype);
    const calls = [];
    child.socketIO = { notifyClient: id => calls.push(id) };
    child.pendingRequests = new Map();
    const originalMessages = new Set(process.listeners('message'));
    const originalDisconnects = new Set(process.listeners('disconnect'));
    child.ipcInit();
    t.after(() => {
        for (const listener of process.listeners('message'))
            if (!originalMessages.has(listener)) process.removeListener('message', listener);
        for (const listener of process.listeners('disconnect'))
            if (!originalDisconnects.has(listener)) process.removeListener('disconnect', listener);
    });
    parent.child = { send: message => process.emit('message', message) };
    parent.notifyClient(42);
    parent.notifyClient();
    assert.deepEqual(calls, [42, undefined]);
});

test('operator events identify deleted recordings and changed thumbnails but not unrelated rule updates', () => {
    const EventSetter = loadSource('src/model/event/EventSetter.ts').default;
    const setter = Object.create(EventSetter.prototype);
    const registered = {};
    const event = group =>
        new Proxy(
            {},
            {
                get: (_target, method) => callback => {
                    registered[`${group}.${String(method)}`] = callback;
                },
            },
        );
    for (const group of [
        'epgUpdate',
        'encode',
        'rule',
        'reserve',
        'recorded',
        'recording',
        'recordedTag',
        'thumbnail',
    ]) {
        setter[`${group}Event`] = event(group);
    }
    const ids = [];
    setter.ipc = { notifyClient: id => ids.push(id) };
    setter.reservationManage = { updateRule: async () => {} };
    setter.set();
    registered['thumbnail.setAdded'](99, 42);
    registered['thumbnail.setDeleted'](42);
    registered['recorded.setDeleteRecorded']({ id: 42, isRecording: false });
    registered['rule.setAdded'](7);
    assert.deepEqual(ids, [42, 42, 42, undefined]);
});

test('thumbnail deletion notifies its recording after the DB commit even when file cleanup fails', async () => {
    const ThumbnailManageModel = loadSource('src/model/operator/thumbnail/ThumbnailManageModel.ts', {
        '../../../util/FileUtil': {
            __esModule: true,
            default: {
                unlink: async () => {
                    throw new Error('file cleanup failed');
                },
            },
        },
    }).default;
    const model = Object.create(ThumbnailManageModel.prototype);
    const calls = [];
    model.thumbnailDB = {
        findId: async () => ({ recordedId: 42, filePath: '42.jpg' }),
        deleteOnce: async id => calls.push(['delete', id]),
    };
    model.thumbnailEvent = { emitDeleted: id => calls.push(['notify', id]) };
    model.config = { thumbnail: '/thumbnails' };
    model.log = { system: { info() {}, error() {} } };
    await assert.rejects(model.delete(99), /file cleanup failed/);
    assert.deepEqual(calls, [
        ['delete', 99],
        ['notify', 42],
    ]);
    calls.length = 0;
    model.thumbnailDB.deleteOnce = async () => {
        throw new Error('DB delete failed');
    };
    await assert.rejects(model.delete(99), /DB delete failed/);
    assert.deepEqual(calls, []);
});

test('SocketBridge excludes history on general status events, scopes dedicated events, and resyncs on reconnect', t => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    t.after(() => client.clear());
    const history = ['recorded-playback-history', 7, false];
    const otherHistory = ['recorded-playback-history', 9, false];
    const settings = ['recorded-playback-history-settings', 7];
    const recorded = ['recorded', 'list'];
    client.setQueryData(history, { items: [{ recorded: { id: 42 } }] });
    client.setQueryData(otherHistory, { items: [] });
    client.setQueryData(settings, { enabled: true });
    client.setQueryData(recorded, {});
    const invalidated = key => client.getQueryState(key).isInvalidated;
    const socket = new EventEmitter();
    let closed = false;
    socket.close = () => {
        closed = true;
    };
    let cleanup;
    const originalLocation = global.location;
    global.location = { protocol: 'http:', hostname: 'localhost', port: '8888' };
    t.after(() => {
        cleanup?.();
        global.location = originalLocation;
    });
    const bridge = loadSource('client/src/core/socket/SocketBridge.tsx', {
        react: {
            useEffect: effect => {
                cleanup = effect();
            },
        },
        '@tanstack/react-query': { useQueryClient: () => client },
        'socket.io-client': { io: () => socket },
        '../path': { withBasePath: value => value },
        './historyNotifications': loadSource('client/src/core/socket/historyNotifications.ts'),
    });
    const connections = [];
    bridge.SocketBridge({ socketIOPort: 8888, onConnectionChange: value => connections.push(value) });
    socket.emit('updateStatus');
    assert.equal(invalidated(recorded), true);
    assert.equal(invalidated(history), false);
    assert.equal(invalidated(settings), false);
    socket.emit('updateEncode');
    assert.equal(invalidated(history), false);
    socket.emit('updateRecordedPlaybackHistory', { userId: 7 });
    assert.equal(invalidated(history), true);
    assert.equal(invalidated(otherHistory), false);
    assert.equal(invalidated(settings), false);
    socket.emit('disconnect');
    socket.emit('connect');
    assert.equal(invalidated(otherHistory), true);
    assert.equal(invalidated(settings), true);
    assert.deepEqual(connections, [false, false, true]);
    cleanup();
    assert.equal(closed, true);
    assert.equal(socket.listenerCount('updateRecordedPlaybackHistory'), 0);
});

test('history refresh button remains enabled during background fetching and disables during manual refresh', () => {
    function button({ fetching = false, manual = false, pending = false } = {}) {
        let mutation = 0;
        const query = {
            isFetching: fetching,
            isPending: pending,
            error: null,
            data: { items: [], enabled: true },
            refetch: async () => {},
        };
        const page = loadSource('client/src/pages/WatchHistoryPage.tsx', {
            react: { useRef: value => ({ current: value }) },
            'react-router-dom': { useNavigate: () => () => {} },
            '@tanstack/react-query': {
                useQueryClient: () => ({}),
                useQuery: option => (option.queryKey[0] === 'channels' ? { data: [] } : query),
                useMutation: () => ({ isPending: mutation++ === 3 && manual, mutate() {} }),
            },
            '@mui/material': new Proxy({}, { get: (_target, property) => String(property) }),
            '@mui/icons-material/DeleteOutlineOutlined': 'DeleteIcon',
            '@mui/icons-material/RefreshOutlined': 'RefreshIcon',
            '@mui/icons-material/ViewListOutlined': 'ViewListIcon',
            '../components/PageHeader': { PageHeader: 'PageHeader' },
            '../components/ProgramThumbnail': { ProgramThumbnail: 'ProgramThumbnail' },
            '../core/api/queries': { api: {} },
            '../core/notifications/Notifications': { useNotifications: () => ({ notify() {} }) },
            '../core/storage/activeUser': { useActiveUser: () => 7 },
            '../core/storage/settings': { useSettings: () => ({ isHalfWidthDisplayed: false }) },
        });
        return page.WatchHistoryPage().props.children[0].props.actions.props;
    }
    assert.equal(button().disabled, false);
    assert.equal(button({ fetching: true }).disabled, false);
    assert.equal(button({ manual: true, fetching: true }).disabled, true);
    assert.equal(button({ pending: true }).disabled, true);
});
