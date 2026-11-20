'use strict';

require('./ts-cjs-compat.cjs');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');
const { QueryClient } = require('../../client/node_modules/@tanstack/react-query');

const previousTypeScriptLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
            esModuleInterop: true,
        },
        fileName: filename,
    }).outputText;
    module._compile(output, filename);
};

const {
    invalidateAllPlaybackHistory,
    invalidatePlaybackHistory,
} = require('../../client/src/core/socket/historyNotifications.ts');
if (previousTypeScriptLoader === undefined) delete require.extensions['.ts'];
else require.extensions['.ts'] = previousTypeScriptLoader;

function createQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

function seed(client, queryKey, data = { value: queryKey[0] }) {
    client.setQueryData(queryKey, data);
}

function buildWithoutData(client, queryKey) {
    return client.getQueryCache().build(client, { queryKey });
}

function invalidated(client, queryKey) {
    return client.getQueryCache().find({ queryKey, exact: true })?.state.isInvalidated ?? false;
}

test('user notification invalidates only that user history and optional settings across half-width variants', () => {
    const client = createQueryClient();
    const userOneHistory = [
        ['recorded-playback-history', 1, true],
        ['recorded-playback-history', 1, false],
        ['recorded-playback-history', 1, true, 'page-2'],
    ];
    const otherKeys = [
        ['recorded-playback-history', 2, true],
        ['recorded-playback-history-settings', 1],
        ['recorded-playback-history-settings', 2],
        ['recording', 1, true],
        ['recorded', 1, true],
        ['reserves', 'normal', 1],
        ['rules', 1],
    ];
    for (const key of [...userOneHistory, ...otherKeys]) seed(client, key);

    invalidatePlaybackHistory(client, { userId: 1 });

    for (const key of userOneHistory) assert.equal(invalidated(client, key), true, String(key));
    for (const key of otherKeys) assert.equal(invalidated(client, key), false, String(key));

    invalidatePlaybackHistory(client, { userId: 1, settings: true });
    assert.equal(invalidated(client, ['recorded-playback-history-settings', 1]), true);
    assert.equal(invalidated(client, ['recorded-playback-history-settings', 2]), false);
});

test('recorded ID notification invalidates only cached histories containing an affected recording', () => {
    const client = createQueryClient();
    const keys = {
        matchingUserOneHalfWidth: ['recorded-playback-history', 1, true],
        matchingUserOneFullWidth: ['recorded-playback-history', 1, false],
        matchingUserTwo: ['recorded-playback-history', 2, true],
        nonMatching: ['recorded-playback-history', 2, false],
        settingsOne: ['recorded-playback-history-settings', 1],
        settingsTwo: ['recorded-playback-history-settings', 2],
        recording: ['recording', 1, true],
        recorded: ['recorded', 50, true],
        reserves: ['reserves', 'normal', 1],
        rules: ['rules', 1],
    };
    seed(client, keys.matchingUserOneHalfWidth, { items: [{ recorded: { id: 42 } }] });
    seed(client, keys.matchingUserOneFullWidth, { items: [{ recorded: { id: 7 } }, { recorded: { id: 42 } }] });
    seed(client, keys.matchingUserTwo, { items: [{ recorded: { id: 42 } }] });
    seed(client, keys.nonMatching, { items: [{ recorded: { id: 7 } }] });
    for (const key of Object.values(keys).slice(4)) seed(client, key);
    const initiallyUnfetched = ['recorded-playback-history', 3, true];
    buildWithoutData(client, initiallyUnfetched);

    invalidatePlaybackHistory(client, { recordedIds: [42] });

    for (const name of ['matchingUserOneHalfWidth', 'matchingUserOneFullWidth', 'matchingUserTwo']) {
        assert.equal(invalidated(client, keys[name]), true, name);
    }
    for (const name of ['nonMatching', 'settingsOne', 'settingsTwo', 'recording', 'recorded', 'reserves', 'rules']) {
        assert.equal(invalidated(client, keys[name]), false, name);
    }
    assert.equal(invalidated(client, initiallyUnfetched), false);
});

test('empty, malformed, and unknown notifications do not invalidate cache entries', () => {
    const client = createQueryClient();
    const keys = [
        ['recorded-playback-history', 1, true],
        ['recorded-playback-history-settings', 1],
        ['recording', 1],
    ];
    for (const key of keys) seed(client, key);

    for (const update of [
        undefined,
        null,
        'update',
        {},
        { userId: '1' },
        { recordedIds: [] },
        { recordedIds: [1, '2'] },
        { userId: 1, recordedIds: [1] },
    ]) {
        invalidatePlaybackHistory(client, update);
    }

    for (const key of keys) assert.equal(invalidated(client, key), false, String(key));
});

test('reconnect invalidation targets the two playback history roots for every user', () => {
    const client = createQueryClient();
    const historyKeys = [
        ['recorded-playback-history', 1, true],
        ['recorded-playback-history', 1, false],
        ['recorded-playback-history', 2, true],
        ['recorded-playback-history-settings', 1],
        ['recorded-playback-history-settings', 2],
    ];
    const unrelatedKeys = [
        ['recording', 1],
        ['recorded', 1],
        ['reserves', 'normal', 1],
        ['rules', 1],
    ];
    for (const key of [...historyKeys, ...unrelatedKeys]) seed(client, key);

    invalidateAllPlaybackHistory(client);

    for (const key of historyKeys) assert.equal(invalidated(client, key), true, String(key));
    for (const key of unrelatedKeys) assert.equal(invalidated(client, key), false, String(key));
});
