const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');
const { DataSource } = require('typeorm');

const sourcePath = path.resolve(__dirname, '../../src/db/migrations/sqlite/1793100000000-AddKeyframeAnalysis.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const loaded = new Module(sourcePath, module);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);
const Migration = loaded.exports.AddKeyframeAnalysis1793100000000;

test('keyframe migration preserves basic caches, is repeatable, cascades deletion, and rolls back', async t => {
    const db = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [], synchronize: false });
    await db.initialize();
    t.after(() => db.destroy());
    const runner = db.createQueryRunner();
    await runner.query('CREATE TABLE video_file (id integer PRIMARY KEY, analyzedAt bigint, analysisError text)');
    await runner.query("INSERT INTO video_file VALUES (1, 100, NULL), (2, NULL, NULL), (3, 200, 'failed')");
    const migration = new Migration();
    await migration.up(runner);
    assert.deepEqual(await runner.query('SELECT id, analysisVersion FROM video_file ORDER BY id'), [
        { id: 1, analysisVersion: 1 },
        { id: 2, analysisVersion: 0 },
        { id: 3, analysisVersion: 0 },
    ]);
    await runner.query(
        "INSERT INTO video_file_keyframe_info (videoFileId, version, sourceSize, sourceMtime, requestedAt, result) VALUES (1, 1, 1000, 2000, 3000, 'previous result')",
    );
    await runner.query('UPDATE video_file SET analysisVersion = 7 WHERE id = 1');
    await migration.up(runner);
    assert.equal((await runner.query('SELECT analysisVersion FROM video_file WHERE id = 1'))[0].analysisVersion, 7);
    assert.equal((await runner.query('SELECT result FROM video_file_keyframe_info'))[0].result, 'previous result');
    await runner.query('DELETE FROM video_file WHERE id = 1');
    assert.deepEqual(await runner.query('SELECT * FROM video_file_keyframe_info'), []);
    await migration.down(runner);
    assert.equal(await runner.hasTable('video_file_keyframe_info'), false);
    assert.equal(await runner.hasColumn('video_file', 'analysisVersion'), false);
    assert.equal((await runner.query('SELECT COUNT(*) AS n FROM video_file'))[0].n, 2);
});
