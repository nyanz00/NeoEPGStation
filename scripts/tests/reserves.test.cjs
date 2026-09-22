const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScriptModule(relativePath) {
    const filename = path.join(__dirname, '..', '..', relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
        fileName: filename,
    }).outputText;
    const loaded = { exports: {} };
    Function(
        'exports',
        'module',
        'require',
        '__filename',
        '__dirname',
        output,
    )(loaded.exports, loaded, require, filename, path.dirname(filename));
    return loaded.exports;
}

const reserves = loadTypeScriptModule('client/src/core/reserves.ts');
const sessionValues = new Map();
global.sessionStorage = {
    getItem: key => sessionValues.get(key) ?? null,
    setItem: (key, value) => sessionValues.set(key, String(value)),
    removeItem: key => sessionValues.delete(key),
};
const manualReserve = loadTypeScriptModule('client/src/core/storage/manualReserve.ts');

test('reservation user follows URL history and repairs deleted users', () => {
    assert.deepEqual(reserves.resolveReserveUserFilter(null, 1, [1, 2]), { userId: 1, replaceRoute: false });
    assert.deepEqual(reserves.resolveReserveUserFilter('2', 1, [1, 2]), { userId: 2, replaceRoute: false });
    assert.deepEqual(reserves.resolveReserveUserFilter(null, 1, [1, 2]), { userId: 1, replaceRoute: false });
    assert.deepEqual(reserves.resolveReserveUserFilter('9', 1, [1, 2]), { userId: 1, replaceRoute: true });
    assert.deepEqual(reserves.resolveReserveUserFilter('9', 9), { userId: 9, replaceRoute: false });
    assert.deepEqual(reserves.resolveReserveUserFilter('9', 9, [2]), { userId: 2, replaceRoute: true });
});

test('reservation selections retain only items still visible', () => {
    const selected = new Set([10, 20, 30]);
    assert.deepEqual([...reserves.reconcileReserveSelection(selected, [20, 30, 40])], [20, 30]);
    assert.equal(reserves.reconcileReserveSelection(selected, [10, 20, 30]), selected);
});

test('manual reservation history restores only its original route', () => {
    sessionValues.clear();
    const snapshot = {
        routeSearch: '?programId=100',
        programId: 100,
        state: {
            userId: 1,
            allowEndLack: true,
            parentDirectoryName: 'recorded',
            directory: 'anime',
            recordedFormat: 'm2ts',
            encodes: [
                { mode: 'h264', parentDirectoryName: 'encoded', directory: 'one' },
                { mode: '', parentDirectoryName: '', directory: '' },
                { mode: '', parentDirectoryName: '', directory: '' },
            ],
            deleteOriginal: false,
            updateThumbnail: true,
        },
        timeSpecified: {
            enabled: true,
            name: '番組名',
            channelId: 1,
            startAt: '2026-09-22T20:00',
            endAt: '2026-09-22T20:30',
        },
    };
    manualReserve.saveManualReserveHistory('entry-key', snapshot);
    assert.deepEqual(manualReserve.loadManualReserveHistory('entry-key', '?programId=100', 100), snapshot);
    assert.equal(manualReserve.loadManualReserveHistory('entry-key', '?programId=101', 100), null);
    assert.equal(manualReserve.loadManualReserveHistory('entry-key', '?programId=100', 101), null);
    manualReserve.saveManualReserveHistory('invalid-user', { ...snapshot, state: { ...snapshot.state, userId: 0 } });
    assert.equal(manualReserve.loadManualReserveHistory('invalid-user', '?programId=100', 100), null);
    manualReserve.clearManualReserveHistory('entry-key');
    assert.equal(manualReserve.loadManualReserveHistory('entry-key', '?programId=100', 100), null);
});
