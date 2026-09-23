const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { DataSource } = require('typeorm');

function loadMigration() {
    const sourcePath = path.resolve(
        __dirname,
        '../../src/db/migrations/sqlite/1790000000000-AddRecordedHistoryLimitAndSessions.ts',
    );
    const source = fs.readFileSync(sourcePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
    }).outputText;
    const loadedModule = new Module(sourcePath, module);
    loadedModule.filename = sourcePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
    loadedModule._compile(compiled, sourcePath);
    return loadedModule.exports.AddRecordedHistoryLimitAndSessions1790000000000;
}

const AddRecordedHistoryLimitAndSessions = loadMigration();

test('SQLite migration adds per-user history defaults and watched session storage', async t => {
    const dataSource = new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [],
        migrations: [],
        synchronize: false,
        logging: false,
    });
    t.after(async () => {
        if (dataSource.isInitialized) await dataSource.destroy();
    });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    t.after(async () => queryRunner.release());

    await queryRunner.query(
        'CREATE TABLE "tv_user" ("id" integer PRIMARY KEY, "name" text NOT NULL, "createdAt" bigint NOT NULL)',
    );
    await queryRunner.query(
        'CREATE TABLE "recorded_playback" ("id" integer PRIMARY KEY, "recordedId" integer NOT NULL, "userId" integer NOT NULL, "position" double NOT NULL, "duration" double NOT NULL, "watchedSeconds" double NOT NULL, "lastObservedAt" bigint NOT NULL, "createdAt" bigint NOT NULL, "updatedAt" bigint NOT NULL, "historyUpdatedAt" bigint)',
    );
    await queryRunner.query('INSERT INTO "tv_user" ("id", "name", "createdAt") VALUES (7, ?, 1), (9, ?, 2)', [
        'first',
        'second',
    ]);
    await queryRunner.query(
        'INSERT INTO "recorded_playback" ("id", "recordedId", "userId", "position", "duration", "watchedSeconds", "lastObservedAt", "createdAt", "updatedAt", "historyUpdatedAt") VALUES (1, 42, 7, 10, 100, 5, 1, 1, 2, 2)',
    );

    const migration = new AddRecordedHistoryLimitAndSessions();
    await migration.up(queryRunner);

    const existingUsers = await queryRunner.query('SELECT "id", "recordedHistoryLimit" FROM "tv_user" ORDER BY "id"');
    assert.deepEqual(existingUsers, [
        { id: 7, recordedHistoryLimit: 50 },
        { id: 9, recordedHistoryLimit: 50 },
    ]);
    assert.equal(await queryRunner.hasColumn('recorded_playback', 'watchedSessions'), true);
    const existingPlayback = await queryRunner.query(
        'SELECT "watchedSessions" FROM "recorded_playback" WHERE "id" = 1',
    );
    assert.deepEqual(existingPlayback, [{ watchedSessions: null }]);

    await queryRunner.query('INSERT INTO "tv_user" ("id", "name", "createdAt") VALUES (11, ?, 3)', ['third']);
    const newUser = await queryRunner.query('SELECT "recordedHistoryLimit" FROM "tv_user" WHERE "id" = 11');
    assert.deepEqual(newUser, [{ recordedHistoryLimit: 50 }]);

    await migration.down(queryRunner);
    assert.equal(await queryRunner.hasColumn('tv_user', 'recordedHistoryLimit'), false);
    assert.equal(await queryRunner.hasColumn('recorded_playback', 'watchedSessions'), false);
});
