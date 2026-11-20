const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');
const { DataSource } = require('typeorm');

const originalTsExtension = Module._extensions['.ts'];
Module._extensions['.ts'] = (loadedModule, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            emitDecoratorMetadata: true,
            experimentalDecorators: true,
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
        fileName: filename,
    }).outputText;
    loadedModule._compile(compiled, filename);
};

const EncodeTask = require('../../src/db/entities/EncodeTask.ts').default;
const EncodeTaskSequence = require('../../src/db/entities/EncodeTaskSequence.ts').default;
const {
    AddEncodeTaskSequence1792700001000,
} = require('../../src/db/migrations/sqlite/1792700001000-AddEncodeTaskSequence.ts');
const { getEncodeOwnerFingerprint, persistEncodeRequest } = require('../../src/model/encode/EncodeTaskIntake.ts');
if (originalTsExtension === undefined) delete Module._extensions['.ts'];
else Module._extensions['.ts'] = originalTsExtension;

const makeOption = (recordedId = 4, sourceVideoFileId = 9) => ({ recordedId, sourceVideoFileId });

async function createDataSource(database = ':memory:', synchronize = true) {
    const dataSource = new DataSource({
        type: 'better-sqlite3',
        database,
        entities: [EncodeTask, EncodeTaskSequence],
        synchronize,
        timeout: 3000,
    });
    await dataSource.initialize();
    return dataSource;
}

async function addTask(dataSource, encodeId, status = 'completed') {
    await dataSource.getRepository(EncodeTask).insert({
        encodeId,
        optionJson: JSON.stringify(makeOption()),
        status,
        position: encodeId,
        ownerFingerprint: 'synthetic',
        startedAt: 0,
        outputFilePath: null,
        createdAt: 1,
        updatedAt: 1,
    });
}

async function addSequence(dataSource, nextEncodeId = 1) {
    await dataSource.getRepository(EncodeTaskSequence).insert({ id: 1, nextEncodeId });
}

const dbOperator = dataSource => ({ getConnection: async () => dataSource });

test('owner fingerprint matches the existing hostname and resolved-working-directory identity', () => {
    const expected = crypto
        .createHash('sha256')
        .update(`${os.hostname()}\0${path.resolve(process.cwd())}`)
        .digest('hex');
    assert.equal(getEncodeOwnerFingerprint(), expected);
});

test('SQLite migration seeds the sequence from existing EncodeTask ids', async t => {
    const dataSource = await createDataSource();
    t.after(() => dataSource.destroy());
    await addTask(dataSource, 17);
    const queryRunner = dataSource.createQueryRunner();
    try {
        await new AddEncodeTaskSequence1792700001000().up(queryRunner);
    } finally {
        await queryRunner.release();
    }
    const sequence = await dataSource.getRepository(EncodeTaskSequence).findOne({ where: { id: 1 } });
    assert.equal(sequence.nextEncodeId, 18);
    const result = await persistEncodeRequest(dbOperator(dataSource), makeOption(), 10);
    assert.equal(result.encodeId, 18);
});

test('allocates and persists a pending task with sequence CAS and initial metadata', async t => {
    const dataSource = await createDataSource();
    t.after(() => dataSource.destroy());
    await addSequence(dataSource, 1);
    const result = await persistEncodeRequest(dbOperator(dataSource), makeOption(), 3);
    assert.equal(result.encodeId, 1);
    const task = await dataSource.getRepository(EncodeTask).findOne({ where: { encodeId: 1 } });
    assert.equal(task.status, 'pending');
    assert.equal(task.position, 1);
    assert.equal(task.ownerFingerprint, getEncodeOwnerFingerprint());
    assert.equal(task.startedAt, 0);
    assert.equal(task.outputFilePath, null);
    assert.equal(JSON.parse(task.optionJson).encodeId, 1);
    assert.equal(typeof task.createdAt, 'number');
    assert.equal(task.updatedAt, task.createdAt);
    const sequence = await dataSource.getRepository(EncodeTaskSequence).findOne({ where: { id: 1 } });
    assert.equal(sequence.nextEncodeId, 2);
});

test('does not reuse ids after completed tasks are deleted', async t => {
    const dataSource = await createDataSource();
    t.after(() => dataSource.destroy());
    await addSequence(dataSource, 1);
    const first = await persistEncodeRequest(dbOperator(dataSource), makeOption(), 10);
    await dataSource.getRepository(EncodeTask).clear();
    const second = await persistEncodeRequest(dbOperator(dataSource), makeOption(5, 10), 10);
    assert.equal(first.encodeId, 1);
    assert.equal(second.encodeId, 2);
});

test('uses a higher legacy or restored task id even when the sequence is behind', async t => {
    const dataSource = await createDataSource();
    t.after(() => dataSource.destroy());
    await addSequence(dataSource, 2);
    await addTask(dataSource, 50);
    const result = await persistEncodeRequest(dbOperator(dataSource), makeOption(), 10);
    assert.equal(result.encodeId, 51);
    const sequence = await dataSource.getRepository(EncodeTaskSequence).findOne({ where: { id: 1 } });
    assert.equal(sequence.nextEncodeId, 52);
});

test('rejects at the active queue limit and when the migration sequence is missing', async t => {
    const fullDB = await createDataSource();
    t.after(() => fullDB.destroy());
    await addSequence(fullDB);
    await addTask(fullDB, 1, 'pending');
    await assert.rejects(persistEncodeRequest(dbOperator(fullDB), makeOption(), 1), { message: 'EncodeQueueFull' });

    const uninitializedDB = await createDataSource();
    t.after(() => uninitializedDB.destroy());
    await assert.rejects(persistEncodeRequest(dbOperator(uninitializedDB), makeOption(), 10), {
        message: 'EncodeTaskSequenceMissing',
    });
});

test('a non-key insert failure rolls back the sequence and is not retried', async t => {
    const dataSource = await createDataSource();
    t.after(() => dataSource.destroy());
    await addSequence(dataSource, 1);
    await dataSource.query(
        "CREATE TRIGGER fail_encode_task BEFORE INSERT ON encode_task BEGIN SELECT RAISE(ABORT, 'synthetic insert failure'); END",
    );

    await assert.rejects(persistEncodeRequest(dbOperator(dataSource), makeOption(), 10), /synthetic insert failure/);
    let sequence = await dataSource.getRepository(EncodeTaskSequence).findOne({ where: { id: 1 } });
    assert.equal(sequence.nextEncodeId, 1);
    assert.equal(await dataSource.getRepository(EncodeTask).count(), 0);

    await dataSource.query('DROP TRIGGER fail_encode_task');
    const result = await persistEncodeRequest(dbOperator(dataSource), makeOption(), 10);
    assert.equal(result.encodeId, 1);
});

test('concurrent intake through two connections receives distinct ids without overwriting', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-encode-intake-'));
    const database = path.join(directory, 'intake.sqlite');
    const firstConnection = await createDataSource(database, true);
    const secondConnection = await createDataSource(database, false);
    t.after(async () => {
        await Promise.all([firstConnection.destroy(), secondConnection.destroy()]);
        fs.rmSync(directory, { recursive: true, force: true });
    });
    await addSequence(firstConnection);

    const results = await Promise.all([
        persistEncodeRequest(dbOperator(firstConnection), makeOption(10, 101), 10),
        persistEncodeRequest(dbOperator(secondConnection), makeOption(20, 202), 10),
    ]);
    assert.deepEqual(
        results.map(result => result.encodeId).sort((a, b) => a - b),
        [1, 2],
    );
    const rows = await firstConnection.getRepository(EncodeTask).find({ order: { encodeId: 'ASC' } });
    assert.equal(rows.length, 2);
    assert.deepEqual(
        rows.map(row => JSON.parse(row.optionJson).recordedId),
        [10, 20],
    );
    const sequence = await firstConnection.getRepository(EncodeTaskSequence).findOne({ where: { id: 1 } });
    assert.equal(sequence.nextEncodeId, 3);
});

test('rejects exhausted sequence ids without reusing the final signed 32-bit id', async t => {
    const dataSource = await createDataSource();
    t.after(() => dataSource.destroy());
    await addSequence(dataSource, 0x7fffffff);
    await assert.rejects(persistEncodeRequest(dbOperator(dataSource), makeOption(), 10), {
        message: 'EncodeIdOverflow',
    });
    const sequence = await dataSource.getRepository(EncodeTaskSequence).findOne({ where: { id: 1 } });
    assert.equal(sequence.nextEncodeId, 0x7fffffff);
});
