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

const RecordedPlaybackDB = loadTypeScript('../../src/model/db/RecordedPlaybackDB.ts');

function createPlaybackDB() {
    const rows = [];
    let nextId = 1;
    const repository = {
        findOne: async ({ where }) => {
            const row = rows.find(item => item.recordedId === where.recordedId && item.userId === where.userId);
            return row === undefined ? null : { ...row };
        },
        insert: async value => {
            rows.push({ id: nextId++, ...value });
        },
        update: async (criteria, value) => {
            for (const row of rows) {
                const matches = Array.isArray(criteria)
                    ? criteria.includes(row.id)
                    : typeof criteria === 'number'
                      ? row.id === criteria
                      : Object.entries(criteria).every(([key, expected]) => row[key] === expected);
                if (matches) Object.assign(row, value);
            }
        },
    };
    const db = new RecordedPlaybackDB(
        { getConnection: async () => ({ getRepository: () => repository }) },
        { run: operation => operation() },
    );
    return { db, rows };
}

function sessionUpdate(sessionId, sessionWatchedSeconds, observedAt) {
    return {
        position: observedAt,
        duration: 1_000,
        watchedSecondsDelta: 0,
        sessionId,
        sessionWatchedSeconds,
        observedAt,
        historyLimit: 50,
        historyEnabled: false,
    };
}

test('playback session retries apply only new cumulative time and isolate sessions', async () => {
    const { db, rows } = createPlaybackDB();
    const sessionA = 'session-alpha-0001';
    const sessionB = 'session-bravo-0002';

    let playback = await db.update(42, 7, sessionUpdate(sessionA, 12, 100));
    assert.equal(playback.watchedSeconds, 12);

    playback = await db.update(42, 7, sessionUpdate(sessionA, 12, 200));
    assert.equal(playback.watchedSeconds, 12, 'retrying the same cumulative total must not count it twice');

    playback = await db.update(42, 7, sessionUpdate(sessionA, 17, 300));
    assert.equal(playback.watchedSeconds, 17, 'only the additional five seconds should be added');

    playback = await db.update(42, 7, sessionUpdate(sessionB, 4, 400));
    assert.equal(playback.watchedSeconds, 21, 'a distinct session contributes its own cumulative total');
    assert.deepEqual(JSON.parse(rows[0].watchedSessions), {
        [sessionA]: 17,
        [sessionB]: 4,
    });
});

test('replaying a history item that was removed reapplies the server history limit', async () => {
    const { db, rows } = createPlaybackDB();
    const trims = [];
    db.trimHistory = async (userId, limit) => trims.push({ userId, limit });

    await db.update(42, 7, { ...sessionUpdate('session-alpha-0001', 5, 100), historyEnabled: true });
    await db.removeFromHistory(42, 7);
    assert.equal(rows[0].historyUpdatedAt, null);

    await db.update(42, 7, { ...sessionUpdate('session-alpha-0001', 10, 200), historyEnabled: true });
    assert.equal(trims.length, 2);
    assert.deepEqual(trims[1], { userId: 7, limit: 50 });
    assert.notEqual(rows[0].historyUpdatedAt, null);
});
