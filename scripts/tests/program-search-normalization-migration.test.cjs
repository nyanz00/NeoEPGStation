const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { DataSource } = require('typeorm');

function loadMigration() {
    const previousTsLoader = require.extensions['.ts'];
    require.extensions['.ts'] = (loadedModule, filename) => {
        const source = fs.readFileSync(filename, 'utf8');
        const compiled = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
        }).outputText;
        loadedModule._compile(compiled, filename);
    };

    try {
        const sourcePath = path.resolve(
            __dirname,
            '../../src/db/migrations/sqlite/1790900000000-AddProgramSearchNormalization.ts',
        );
        delete require.cache[sourcePath];
        return require(sourcePath).AddProgramSearchNormalization1790900000000;
    } finally {
        if (previousTsLoader) require.extensions['.ts'] = previousTsLoader;
        else delete require.extensions['.ts'];
    }
}

const AddProgramSearchNormalization = loadMigration();

async function createDataSource(t, migrations = []) {
    const dataSource = new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [],
        migrations,
        synchronize: false,
        logging: false,
    });
    t.after(async () => {
        if (dataSource.isInitialized) await dataSource.destroy();
    });
    await dataSource.initialize();
    return dataSource;
}

async function createLegacyProgramTable(queryRunner) {
    await queryRunner.query(
        'CREATE TABLE "program" (' +
            '"id" integer PRIMARY KEY, ' +
            '"name" text NOT NULL, ' +
            '"halfWidthName" text NOT NULL, ' +
            '"shortName" text NOT NULL, ' +
            '"description" text, ' +
            '"halfWidthDescription" text, ' +
            '"extended" text, ' +
            '"halfWidthExtended" text, ' +
            '"rawExtended" text, ' +
            '"rawHalfWidthExtended" text, ' +
            '"channel" text NOT NULL' +
            ')',
    );
}

test('SQLite migration backfills NFKC search fields in batches and preserves legacy programme data', async t => {
    const dataSource = await createDataSource(t);
    const queryRunner = dataSource.createQueryRunner();
    t.after(async () => queryRunner.release());
    await createLegacyProgramTable(queryRunner);

    const recordCount = 130;
    const legacyRows = [];
    for (let id = 1; id <= recordCount; id++) {
        const row = {
            id,
            name: `表示用 ${id}`,
            halfWidthName: id === 1 ? 'Ⅱ Ａ ｶﾅ ㊤ 〜' : `検索用 ${id}`,
            shortName: `重複確認 ${id}`,
            description: id === 1 ? '㊙ ｶﾞ' : id === 2 ? null : `概要 ${id}`,
            halfWidthDescription: id === 1 ? '㊙ ｶﾞ' : id === 2 ? null : `旧概要 ${id}`,
            extended: id === 1 ? 'Ⅲ ㊦' : id === 2 ? null : `詳細 ${id}`,
            halfWidthExtended: id === 1 ? 'Ⅲ ㊦' : id === 2 ? null : `旧詳細 ${id}`,
            rawExtended: `raw extended ${id}`,
            rawHalfWidthExtended: `raw old extended ${id}`,
            channel: `channel ${id}`,
        };
        legacyRows.push(row);
        await queryRunner.query(
            'INSERT INTO "program" ("id", "name", "halfWidthName", "shortName", "description", ' +
                '"halfWidthDescription", "extended", "halfWidthExtended", "rawExtended", ' +
                '"rawHalfWidthExtended", "channel") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            Object.values(row),
        );
    }

    const migration = new AddProgramSearchNormalization();
    await migration.up(queryRunner);

    const normalizedRows = await queryRunner.query(
        'SELECT "id", "normalizedName", "normalizedDescription", "normalizedExtended" ' +
            'FROM "program" ORDER BY "id"',
    );
    assert.equal(normalizedRows.length, recordCount);
    assert.deepEqual(normalizedRows[0], {
        id: 1,
        normalizedName: 'II A カナ 上 ~',
        normalizedDescription: '秘 ガ',
        normalizedExtended: 'III 下',
    });
    assert.deepEqual(normalizedRows[1], {
        id: 2,
        normalizedName: '検索用 2',
        normalizedDescription: null,
        normalizedExtended: null,
    });
    assert.equal(normalizedRows[129].normalizedName, '検索用 130');

    const preservedRows = await queryRunner.query(
        'SELECT "id", "name", "halfWidthName", "shortName", "description", "halfWidthDescription", ' +
            '"extended", "halfWidthExtended", "rawExtended", "rawHalfWidthExtended", "channel" ' +
            'FROM "program" ORDER BY "id"',
    );
    assert.deepEqual(preservedRows, legacyRows);

    await queryRunner.query(
        'CREATE TRIGGER "reject_rewrite_completed_normalized_program" BEFORE UPDATE ON "program" ' +
            'WHEN OLD."normalizedName" IS NOT NULL BEGIN SELECT RAISE(ABORT, \'completed row rewritten\'); END',
    );
    await migration.up(queryRunner);
    assert.equal(
        (await queryRunner.query('SELECT COUNT(*) AS "count" FROM "program" WHERE "normalizedName" IS NOT NULL'))[0]
            .count,
        recordCount,
    );

    await queryRunner.query('DROP TRIGGER "reject_rewrite_completed_normalized_program"');
    await migration.down(queryRunner);
    for (const column of ['normalizedName', 'normalizedDescription', 'normalizedExtended']) {
        assert.equal(await queryRunner.hasColumn('program', column), false);
    }
    assert.deepEqual(
        await queryRunner.query('SELECT "id", "name", "halfWidthName", "shortName" FROM "program" WHERE "id" = 1'),
        [{ id: 1, name: '表示用 1', halfWidthName: 'Ⅱ Ａ ｶﾅ ㊤ 〜', shortName: '重複確認 1' }],
    );
});

test('SQLite migration resumes when only some normalized columns and values exist', async t => {
    const dataSource = await createDataSource(t);
    const queryRunner = dataSource.createQueryRunner();
    t.after(async () => queryRunner.release());
    await queryRunner.query(
        'CREATE TABLE "program" (' +
            '"id" integer PRIMARY KEY, "name" text NOT NULL, "halfWidthName" text NOT NULL, ' +
            '"shortName" text NOT NULL, "description" text, "halfWidthDescription" text, ' +
            '"extended" text, "halfWidthExtended" text, "normalizedName" text NULL' +
            ')',
    );
    await queryRunner.query(
        'INSERT INTO "program" ("id", "name", "halfWidthName", "shortName", "description", ' +
            '"halfWidthDescription", "extended", "halfWidthExtended", "normalizedName") ' +
            'VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?), (2, ?, ?, ?, ?, ?, ?, ?, NULL)',
        [
            '表示一',
            'I',
            '旧一',
            'desc',
            '旧desc',
            'ext',
            '旧ext',
            'already done',
            '表示二',
            'Ⅱ',
            '旧二',
            null,
            null,
            null,
            null,
        ],
    );

    await new AddProgramSearchNormalization().up(queryRunner);
    assert.deepEqual(
        await queryRunner.query(
            'SELECT "id", "normalizedName", "normalizedDescription", "normalizedExtended" ' +
                'FROM "program" ORDER BY "id"',
        ),
        [
            { id: 1, normalizedName: 'already done', normalizedDescription: null, normalizedExtended: null },
            { id: 2, normalizedName: 'II', normalizedDescription: null, normalizedExtended: null },
        ],
    );
});

test('SQLite migration resumes after a failed second backfill batch without rewriting completed rows', async t => {
    const dataSource = await createDataSource(t);
    const queryRunner = dataSource.createQueryRunner();
    t.after(async () => queryRunner.release());
    await createLegacyProgramTable(queryRunner);

    const recordCount = 130;
    for (let id = 1; id <= recordCount; id++) {
        await queryRunner.query(
            'INSERT INTO "program" ("id", "name", "halfWidthName", "shortName", "channel") ' + 'VALUES (?, ?, ?, ?, ?)',
            [id, `表示 ${id}`, `Ⅰ ${id}`, `旧名 ${id}`, `channel ${id}`],
        );
    }

    const migration = new AddProgramSearchNormalization();
    const originalQuery = queryRunner.query.bind(queryRunner);
    let updateCount = 0;
    queryRunner.query = async (query, parameters) => {
        if (typeof query === 'string' && query.startsWith('UPDATE `program` SET')) {
            updateCount++;
            if (updateCount === 2) throw new Error('simulated failure before second batch update');
        }
        return originalQuery(query, parameters);
    };
    try {
        await assert.rejects(migration.up(queryRunner), /simulated failure before second batch update/);
    } finally {
        queryRunner.query = originalQuery;
    }

    assert.equal(
        (await queryRunner.query('SELECT COUNT(*) AS "count" FROM "program" WHERE "normalizedName" IS NOT NULL'))[0]
            .count,
        64,
    );
    assert.equal(
        (await queryRunner.query('SELECT COUNT(*) AS "count" FROM "program" WHERE "normalizedName" IS NULL'))[0].count,
        recordCount - 64,
    );

    await queryRunner.query(
        'CREATE TRIGGER "reject_rewrite_completed_after_failure" BEFORE UPDATE ON "program" ' +
            'WHEN OLD."normalizedName" IS NOT NULL BEGIN SELECT RAISE(ABORT, \'completed row rewritten\'); END',
    );
    await migration.up(queryRunner);
    assert.equal(
        (await queryRunner.query('SELECT COUNT(*) AS "count" FROM "program" WHERE "normalizedName" IS NOT NULL'))[0]
            .count,
        recordCount,
    );
    assert.equal(
        (await queryRunner.query('SELECT COUNT(*) AS "count" FROM "program" WHERE "normalizedName" IS NULL'))[0].count,
        0,
    );
});

test('TypeORM migration tracking records the migration once across repeated startup runs', async t => {
    const dataSource = await createDataSource(t, [AddProgramSearchNormalization]);
    const queryRunner = dataSource.createQueryRunner();
    t.after(async () => queryRunner.release());
    await createLegacyProgramTable(queryRunner);
    await queryRunner.query(
        'INSERT INTO "program" ("id", "name", "halfWidthName", "shortName", "channel") ' + 'VALUES (1, ?, ?, ?, ?)',
        ['表示', 'Ⅱ', '旧', 'channel'],
    );

    const firstRun = await dataSource.runMigrations();
    const secondRun = await dataSource.runMigrations();
    assert.equal(firstRun.length, 1);
    assert.equal(secondRun.length, 0);
    assert.deepEqual(await queryRunner.query('SELECT "normalizedName" FROM "program" WHERE "id" = 1'), [
        { normalizedName: 'II' },
    ]);
    assert.deepEqual(
        await queryRunner.query('SELECT "name" FROM "migrations" WHERE "name" = ?', [
            'AddProgramSearchNormalization1790900000000',
        ]),
        [{ name: 'AddProgramSearchNormalization1790900000000' }],
    );
});
