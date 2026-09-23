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

function createApiModelFixture(userValues = [{ id: 7, isRecordedHistoryEnabled: true, recordedHistoryLimit: 8 }]) {
    const users = new Map(userValues.map(user => [user.id, { ...user }]));
    const calls = { history: [], progress: [], trims: [], settings: [] };
    const userDB = {
        findId: async userId => users.get(userId) ?? null,
        updateRecordedHistorySettings: async (userId, option) => {
            calls.settings.push({ userId, option: { ...option } });
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
        trimHistory: async (userId, limit) => calls.trims.push({ userId, limit }),
        update: async (recordedId, userId, value) => {
            calls.progress.push({ recordedId, userId, value: { ...value } });
            return {
                position: value.position,
                duration: value.duration,
                watchedSeconds: 0,
                updatedAt: value.observedAt,
            };
        },
    };
    const model = new RecordedPlaybackApiModel(
        playbackDB,
        { exists: async () => true, findIds: async () => [] },
        { convertRecordedToRecordedItem: () => assert.fail('No history items should be converted') },
        { waitUntilReady: async () => {}, getRecordedIndex: () => new Map() },
        userDB,
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
});

test('playback updates ignore a client history limit and use the saved user settings', async () => {
    const { model, calls } = createApiModelFixture([
        { id: 7, isRecordedHistoryEnabled: false, recordedHistoryLimit: 11 },
    ]);

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
});

test('lowering history settings updates that user and trims to the new saved limit', async () => {
    const { model, calls } = createApiModelFixture([
        { id: 7, isRecordedHistoryEnabled: true, recordedHistoryLimit: 15 },
    ]);

    const settings = await model.updateHistorySettings(7, { enabled: false, limit: 4 });

    assert.deepEqual(calls.settings, [{ userId: 7, option: { enabled: false, limit: 4 } }]);
    assert.deepEqual(calls.trims, [{ userId: 7, limit: 4 }]);
    assert.deepEqual(settings, { enabled: false, limit: 4 });
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
