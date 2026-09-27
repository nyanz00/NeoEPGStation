const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { DataSource } = require('typeorm');

const sourcePath = path.resolve(__dirname, '../../src/db/migrations/sqlite/1790100000000-AddUserAdmin.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loadedModule._compile(compiled, sourcePath);
const { AddUserAdmin1790100000000 } = loadedModule.exports;

test('admin migration grants only the lowest existing normal user and remains repeatable', async t => {
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
        'CREATE TABLE "tv_user" ("id" integer PRIMARY KEY, "name" text NOT NULL, "createdAt" bigint NOT NULL)',
    );
    await runner.query('INSERT INTO "tv_user" ("id", "name", "createdAt") VALUES (4, ?, 1), (9, ?, 2)', [
        'first',
        'second',
    ]);

    const migration = new AddUserAdmin1790100000000();
    await migration.up(runner);
    assert.deepEqual(await runner.query('SELECT "id", "isAdmin" FROM "tv_user" ORDER BY "id"'), [
        { id: 4, isAdmin: 1 },
        { id: 9, isAdmin: 0 },
    ]);

    await runner.query('UPDATE "tv_user" SET "isAdmin" = 1 WHERE "id" = 9');
    await migration.up(runner);
    assert.deepEqual(await runner.query('SELECT "id", "isAdmin" FROM "tv_user" ORDER BY "id"'), [
        { id: 4, isAdmin: 1 },
        { id: 9, isAdmin: 1 },
    ]);
    await migration.down(runner);
    assert.equal(await runner.hasColumn('tv_user', 'isAdmin'), false);
});
