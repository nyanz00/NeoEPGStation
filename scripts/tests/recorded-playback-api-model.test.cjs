const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

function loadTypeScript(sourcePath) {
    const absolutePath = path.resolve(__dirname, sourcePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const load = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath && request.startsWith('.')) return {};
        return load.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = load;
    }
    return loadedModule.exports.default;
}

const RecordedPlaybackApiModel = loadTypeScript('../../src/model/api/recorded/RecordedPlaybackApiModel.ts');
const TvUserDB = loadTypeScript('../../src/model/db/TvUserDB.ts');

function createApiModelFixture(
    userValues = [{ id: 7, isRecordedHistoryEnabled: true, recordedHistoryLimit: 8 }],
    { historyUpdatedAt = 123, updateError = null, settingsError = null, trimError = null } = {},
) {
    const users = new Map(userValues.map(user => [user.id, { ...user }]));
    const calls = { history: [], progress: [], removals: [], trims: [], settings: [], notifications: [] };
    const userDB = {
        findId: async userId => users.get(userId) ?? null,
        updateRecordedHistorySettings: async (userId, option) => {
            calls.settings.push({ userId, option: { ...option } });
            if (settingsError !== null) throw settingsError;
            const user = users.get(userId);
            users.set(userId, {
                ...user,
                ...(option.enabled === undefined ? {} : { isRecordedHistoryEnabled: option.enabled }),
                ...(option.limit === undefined ? {} : { recordedHistoryLimit: option.limit }),
            });
        },
    };
    const playbackDB = {
        find: async () => null,
        findHistory: async (userId, limit) => {
            calls.history.push({ userId, limit });
            return [];
        },
        removeFromHistory: async (recordedId, userId) => calls.removals.push({ recordedId, userId }),
        trimHistory: async (userId, limit) => {
            calls.trims.push({ userId, limit });
            if (trimError !== null) throw trimError;
        },
        update: async (recordedId, userId, value) => {
            calls.progress.push({ recordedId, userId, value: { ...value } });
            if (updateError !== null) throw updateError;
            return {
                position: value.position,
                duration: value.duration,
                watchedSeconds: 0,
                updatedAt: value.observedAt,
                historyUpdatedAt,
            };
        },
    };
    const model = new RecordedPlaybackApiModel(
        playbackDB,
        { exists: async () => true, findIds: async () => [] },
        { convertRecordedToRecordedItem: () => assert.fail('No history items should be converted') },
        { waitUntilReady: async () => {}, getRecordedIndex: () => new Map() },
        userDB,
        {
            notifyRecordedPlaybackHistory: async (userId, settings = false) =>
                calls.notifications.push({ userId, settings }),
        },
    );
    return { model, calls, users };
}

test('history retrieval takes its limit from each server user record', async () => {
    const { model, calls } = createApiModelFixture([
        { id: 7, isRecordedHistoryEnabled: true, recordedHistoryLimit: 3 },
        { id: 9, isRecordedHistoryEnabled: true, recordedHistoryLimit: 17 },
    ]);

    await model.getHistory(7, false);
    await model.getHistory(9, true);

    assert.deepEqual(calls.history, [
        { userId: 7, limit: 3 },
        { userId: 9, limit: 17 },
    ]);
    assert.deepEqual(calls.notifications, []);
});

test('playback updates ignore a client history limit and use the saved user settings', async () => {
    const { model, calls } = createApiModelFixture(
        [{ id: 7, isRecordedHistoryEnabled: false, recordedHistoryLimit: 11 }],
        { historyUpdatedAt: null },
    );

    await model.update(42, 7, {
        position: 30,
        duration: 600,
        sessionId: 'session-alpha-0001',
        sessionWatchedSeconds: 12,
        observedAt: 0,
        historyLimit: 1,
    });

    assert.equal(calls.progress.length, 1);
    assert.equal(calls.progress[0].userId, 7);
    assert.equal(calls.progress[0].value.historyLimit, 11);
    assert.equal(calls.progress[0].value.historyEnabled, false);
    assert.equal(calls.progress[0].value.sessionId, 'session-alpha-0001');
    assert.equal(calls.progress[0].value.sessionWatchedSeconds, 12);
    assert.equal(calls.progress[0].value.watchedSecondsDelta, 0);
    assert.deepEqual(calls.notifications, []);
});

test('playback updates notify only users whose saved history row exists', async () => {
    const { model, calls } = createApiModelFixture(
        [
            { id: 7, isRecordedHistoryEnabled: false, recordedHistoryLimit: 11 },
            { id: 9, isRecordedHistoryEnabled: true, recordedHistoryLimit: 5 },
        ],
        { historyUpdatedAt: 456 },
    );

    await model.update(42, 7, { position: 30, duration: 600, watchedSecondsDelta: 0 });
    assert.deepEqual(calls.notifications, [{ userId: 7, settings: false }]);

    // The DB's BIGINT timestamp can also be represented as a string. Membership
    // is defined by null, independently of the driver's numeric conversion.
    const stringTimestamp = createApiModelFixture(undefined, { historyUpdatedAt: '456' });
    await stringTimestamp.model.update(42, 7, { position: 30, duration: 600, watchedSecondsDelta: 0 });
    assert.deepEqual(stringTimestamp.calls.notifications, [{ userId: 7, settings: false }]);

    calls.notifications.length = 0;
    const untracked = createApiModelFixture([{ id: 9, isRecordedHistoryEnabled: false, recordedHistoryLimit: 5 }], {
        historyUpdatedAt: null,
    });
    await untracked.model.update(42, 9, { position: 30, duration: 600, watchedSecondsDelta: 0 });
    assert.deepEqual(untracked.calls.notifications, []);
});

test('failed playback and history settings writes do not notify', async () => {
    const updateFailure = createApiModelFixture(undefined, { updateError: new Error('progress write failed') });
    await assert.rejects(
        updateFailure.model.update(42, 7, { position: 30, duration: 600, watchedSecondsDelta: 0 }),
        /progress write failed/,
    );
    assert.deepEqual(updateFailure.calls.notifications, []);

    const settingsFailure = createApiModelFixture(undefined, { settingsError: new Error('settings write failed') });
    await assert.rejects(settingsFailure.model.updateHistorySettings(7, { enabled: false }), /settings write failed/);
    assert.deepEqual(settingsFailure.calls.notifications, []);
});

test('removing a history entry notifies only the requested user', async () => {
    const { model, calls } = createApiModelFixture([
        { id: 7, isRecordedHistoryEnabled: true, recordedHistoryLimit: 8 },
        { id: 9, isRecordedHistoryEnabled: true, recordedHistoryLimit: 8 },
    ]);

    await model.removeFromHistory(42, 9);

    assert.deepEqual(calls.removals, [{ recordedId: 42, userId: 9 }]);
    assert.deepEqual(calls.notifications, [{ userId: 9, settings: false }]);
});

test('lowering history settings updates that user and trims to the new saved limit', async () => {
    const { model, calls } = createApiModelFixture([
        { id: 7, isRecordedHistoryEnabled: true, recordedHistoryLimit: 15 },
    ]);

    const settings = await model.updateHistorySettings(7, { enabled: false, limit: 4 });

    assert.deepEqual(calls.settings, [{ userId: 7, option: { enabled: false, limit: 4 } }]);
    assert.deepEqual(calls.trims, [{ userId: 7, limit: 4 }]);
    assert.deepEqual(settings, { enabled: false, limit: 4 });
    assert.deepEqual(calls.notifications, [{ userId: 7, settings: true }]);
});

test('history settings notify after a partial trim failure', async () => {
    const { model, calls } = createApiModelFixture(undefined, { trimError: new Error('trim failed') });

    await assert.rejects(model.updateHistorySettings(7, { limit: 4 }), /trim failed/);

    assert.deepEqual(calls.notifications, [{ userId: 7, settings: true }]);
});

test('TvUserDB writes history settings to the requested server user', async () => {
    const updates = [];
    const userDB = new TvUserDB(
        {
            getConnection: async () => ({
                getRepository: () => ({
                    update: async (userId, values) => updates.push({ userId, values }),
                }),
            }),
        },
        { run: operation => operation() },
    );

    await userDB.updateRecordedHistorySettings(9, { enabled: true, limit: 23 });

    assert.deepEqual(updates, [
        {
            userId: 9,
            values: { isRecordedHistoryEnabled: true, recordedHistoryLimit: 23 },
        },
    ]);
});
