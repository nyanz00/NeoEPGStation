const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');
const { DataSource } = require('typeorm');

function withTypeScriptLoader(callback) {
    const previousTsLoader = require.extensions['.ts'];
    require.extensions['.ts'] = (loadedModule, filename) => {
        const source = fs.readFileSync(filename, 'utf8');
        const compiled = ts.transpileModule(source, {
            compilerOptions: {
                esModuleInterop: true,
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2021,
            },
        }).outputText;
        loadedModule._compile(compiled, filename);
    };
    try {
        return callback();
    } finally {
        if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
        else delete require.extensions['.ts'];
    }
}

const { backfillRecordingTitleMarkers } = withTypeScriptLoader(() =>
    require(path.resolve(__dirname, '../../src/db/migrations/RecordingTitleMarkers.ts')),
);

test('recording title marker backfill handles history safely across batches in SQLite', async t => {
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
    const runner = dataSource.createQueryRunner();
    t.after(async () => runner.release());

    await runner.query(
        'CREATE TABLE "program" ("id" integer PRIMARY KEY, "halfWidthName" text NOT NULL, "shortName" text NOT NULL)',
    );
    await runner.query(
        'CREATE TABLE "recorded" ("id" integer PRIMARY KEY, "halfWidthName" text NOT NULL, "channelId" integer NOT NULL, "endAt" integer NOT NULL)',
    );
    await runner.query(
        'CREATE TABLE "recorded_history" ("id" integer PRIMARY KEY, "name" text NOT NULL, "channelId" integer NOT NULL, "endAt" integer NOT NULL)',
    );

    await runner.query('INSERT INTO "program" VALUES (1, ?, ?), (2, ?, ?)', [
        '連続ドラマ\u{1f21c}',
        '連続ドラマ',
        '連続ドラマ\u{1f21d}',
        '連続ドラマ',
    ]);
    const pageSizeCrossing = 130;
    for (let id = 3; id <= pageSizeCrossing + 2; id++) {
        await runner.query('INSERT INTO "program" VALUES (?, ?, ?)', [id, `Batch ${id}\u{1f21c}`, `legacy ${id}`]);
    }

    await runner.query('INSERT INTO "recorded" VALUES (1, ?, 10, 1000)', ['連続ドラマ\u{1f21c}']);
    await runner.query('INSERT INTO "recorded_history" VALUES (1, ?, 10, 1000)', ['連続ドラマ']);
    await runner.query('INSERT INTO "recorded_history" VALUES (2, ?, 11, 1100)', ['削除済み履歴']);
    await runner.query('INSERT INTO "recorded" VALUES (2, ?, 12, 1200), (3, ?, 12, 1200)', [
        '曖昧候補\u{1f21c}',
        '曖昧候補\u{1f21d}',
    ]);
    await runner.query('INSERT INTO "recorded_history" VALUES (3, ?, 12, 1200)', ['曖昧候補']);

    for (let offset = 0; offset < pageSizeCrossing; offset++) {
        const id = offset + 10;
        const name = `Batch history ${id}`;
        await runner.query('INSERT INTO "recorded" VALUES (?, ?, ?, ?)', [
            id + 10,
            `${name}\u{1f21c}`,
            100 + id,
            2000 + id,
        ]);
        await runner.query('INSERT INTO "recorded_history" VALUES (?, ?, ?, ?)', [id, name, 100 + id, 2000 + id]);
    }

    await backfillRecordingTitleMarkers(runner);

    const programMarkers = await runner.query('SELECT "id", "shortName" FROM "program" WHERE "id" <= 2 ORDER BY "id"');
    assert.deepEqual(programMarkers, [
        { id: 1, shortName: '連続ドラマ[前]' },
        { id: 2, shortName: '連続ドラマ[後]' },
    ]);

    const firstHistoryPage = await runner.query(
        'SELECT "id", "name" FROM "recorded_history" WHERE "id" <= 3 ORDER BY "id"',
    );
    assert.deepEqual(firstHistoryPage, [
        { id: 1, name: '連続ドラマ[前]' },
        { id: 2, name: '削除済み履歴' },
        { id: 3, name: '曖昧候補' },
    ]);
    const pagedHistory = await runner.query(
        'SELECT "id", "name" FROM "recorded_history" WHERE "id" IN (10, 73, 139) ORDER BY "id"',
    );
    assert.deepEqual(pagedHistory, [
        { id: 10, name: 'Batch history 10[前]' },
        { id: 73, name: 'Batch history 73[前]' },
        { id: 139, name: 'Batch history 139[前]' },
    ]);

    await backfillRecordingTitleMarkers(runner);
    const historyAfterSecondRun = await runner.query('SELECT "id", "name" FROM "recorded_history" ORDER BY "id"');
    assert.deepEqual(historyAfterSecondRun, [
        ...firstHistoryPage,
        ...Array.from({ length: pageSizeCrossing }, (_, index) => ({
            id: index + 10,
            name: `Batch history ${index + 10}[前]`,
        })),
    ]);
});
