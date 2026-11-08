'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
require('reflect-metadata');
const ts = require('typescript');
const realTypeorm = require('typeorm');

const channelEntityMock = class Channel {};
const sourcePath = path.resolve(__dirname, '../../src/model/db/ChannelDB.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

function loadChannelDB({ typeorm, channelEntity = channelEntityMock } = {}) {
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
        fileName: sourcePath,
    }).outputText;
    const loadedModule = new Module(sourcePath, module);
    loadedModule.filename = sourcePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === sourcePath) {
            if (request === 'inversify') return { inject: () => () => {}, injectable: () => target => target };
            if (request === 'typeorm' && typeorm !== undefined) return typeorm;
            if (request === '../../db/entities/Channel') return { __esModule: true, default: channelEntity };
            if (request === '../../util/StrUtil') {
                return { __esModule: true, default: { toDBStr: value => value, toHalf: value => value } };
            }
            if (request.startsWith('.')) return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, sourcePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports.default;
}

const MockChannelDB = loadChannelDB({
    typeorm: {
        In: values => ({ operator: 'in', values }),
        Not: value => ({ operator: 'not', value }),
    },
});

function service(id, name = `service-${id}`) {
    return {
        id,
        serviceId: id * 10,
        networkId: 1,
        name,
        hasLogoData: false,
        channel: { type: 'GR', channel: String(id) },
    };
}

function createMockFixture(initialIds = [], { failInsertIds = [], failUpdateIds = [] } = {}) {
    const operations = [];
    const rows = new Map(initialIds.map(id => [id, { id, name: `existing-${id}` }]));
    const queryRunner = {
        manager: {
            clear: async () => {
                operations.push(['clear']);
                assert.fail('Channel refresh must not clear the table');
            },
            async delete(entity, where) {
                assert.equal(entity, channelEntityMock);
                if (where.id?.operator === 'in') {
                    const ids = where.id.values;
                    operations.push(['delete-ids', [...ids]]);
                    for (const id of ids) rows.delete(id);
                    return { affected: ids.length };
                }
                if (where.id?.operator === 'not' && where.id.value?.operator === 'in') {
                    const ids = where.id.value.values;
                    operations.push(['delete-not-in', [...ids]]);
                    for (const id of rows.keys()) if (!ids.includes(id)) rows.delete(id);
                    return { affected: 0 };
                }
                assert.fail(`Unexpected Channel delete condition: ${JSON.stringify(where)}`);
            },
            async insert(entity, value) {
                assert.equal(entity, channelEntityMock);
                operations.push(['insert', value.id]);
                if (failInsertIds.includes(value.id) || rows.has(value.id)) throw new Error(`duplicate ${value.id}`);
                rows.set(value.id, { ...value });
                return { identifiers: [{ id: value.id }] };
            },
            async update(entity, id, value) {
                assert.equal(entity, channelEntityMock);
                operations.push(['update', id]);
                if (failUpdateIds.includes(id) || !rows.has(id)) throw new Error(`update failed ${id}`);
                rows.set(id, { ...value });
                return { affected: 1 };
            },
            createQueryBuilder() {
                const builder = {
                    delete() {
                        operations.push(['query-builder-delete']);
                        return builder;
                    },
                    from(entity) {
                        assert.equal(entity, channelEntityMock);
                        operations.push(['query-builder-from']);
                        return builder;
                    },
                    where(condition) {
                        operations.push(['query-builder-where', condition]);
                        return builder;
                    },
                    async execute() {
                        operations.push(['delete-all']);
                        const affected = rows.size;
                        rows.clear();
                        return { affected };
                    },
                };
                return builder;
            },
        },
        async startTransaction() {
            operations.push(['start']);
        },
        async commitTransaction() {
            operations.push(['commit']);
        },
        async rollbackTransaction() {
            operations.push(['rollback']);
        },
        async release() {
            operations.push(['release']);
        },
    };
    const logger = { system: { error() {} } };
    const channelDB = new MockChannelDB(
        { getLogger: () => logger },
        { getConfig: () => ({}) },
        { getConnection: async () => ({ createQueryRunner: () => queryRunner }) },
        { run: operation => operation() },
    );
    return { channelDB, operations, rows };
}

test('full refresh upserts every present channel before deleting channels outside the refresh set', async () => {
    const { channelDB, operations, rows } = createMockFixture([11, 33]);

    await channelDB.insert([service(11, 'updated-eleven'), service(22)], true);

    assert.deepEqual(operations, [
        ['start'],
        ['insert', 11],
        ['update', 11],
        ['insert', 22],
        ['delete-not-in', [11, 22]],
        ['commit'],
        ['release'],
    ]);
    assert.deepEqual(
        [...rows.keys()].sort((left, right) => left - right),
        [11, 22],
    );
    assert.equal(rows.get(11).name, 'updated-eleven');
});

test('an empty full refresh deletes all rows through a query builder without clearing', async () => {
    const { channelDB, operations, rows } = createMockFixture([7, 8]);

    await channelDB.insert([], true);

    assert.deepEqual(operations, [
        ['start'],
        ['query-builder-delete'],
        ['query-builder-from'],
        ['query-builder-where', '1 = 1'],
        ['delete-all'],
        ['commit'],
        ['release'],
    ]);
    assert.deepEqual([...rows.keys()], []);
});

test('partial updates delete only requested ids and retain other stored channels', async () => {
    const { channelDB, operations, rows } = createMockFixture([1, 2, 4]);

    await channelDB.update({ insert: [service(3)], update: [service(2, 'updated-two')], delete: [1] });

    assert.deepEqual(operations, [
        ['start'],
        ['delete-ids', [1]],
        ['insert', 3],
        ['insert', 2],
        ['update', 2],
        ['commit'],
        ['release'],
    ]);
    assert.deepEqual(
        [...rows.keys()].sort((left, right) => left - right),
        [2, 3, 4],
    );
    assert.equal(rows.get(2).name, 'updated-two');
});

test('an insert and fallback update failure rolls back and always releases the query runner', async () => {
    const { channelDB, operations } = createMockFixture([19], { failUpdateIds: [19] });

    await assert.rejects(channelDB.insert([service(19)], true), /insert error/);

    assert.deepEqual(operations, [['start'], ['insert', 19], ['update', 19], ['rollback'], ['release']]);
});

function loadChannelEntity() {
    const entityPath = path.resolve(__dirname, '../../src/db/entities/Channel.ts');
    const entitySource = fs.readFileSync(entityPath, 'utf8');
    const entityCompiled = ts.transpileModule(entitySource, {
        compilerOptions: {
            emitDecoratorMetadata: true,
            experimentalDecorators: true,
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
        fileName: entityPath,
    }).outputText;
    const loadedEntity = new Module(entityPath, module);
    loadedEntity.filename = entityPath;
    loadedEntity.paths = Module._nodeModulePaths(path.dirname(entityPath));
    loadedEntity._compile(entityCompiled, entityPath);
    return loadedEntity.exports.default;
}

test('TypeORM SQLite full refresh preserves and updates retained rows, prunes removed rows, and handles empty input', async t => {
    const Channel = loadChannelEntity();
    const dataSource = new realTypeorm.DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [Channel],
        migrations: [],
        synchronize: true,
        logging: false,
    });
    t.after(async () => {
        if (dataSource.isInitialized) await dataSource.destroy();
    });
    await dataSource.initialize();

    const ChannelDB = loadChannelDB({ typeorm: realTypeorm, channelEntity: Channel });
    const channelDB = new ChannelDB(
        { getLogger: () => ({ system: { error() {} } }) },
        { getConfig: () => ({}) },
        { getConnection: async () => dataSource },
        { run: operation => operation() },
    );
    const repository = dataSource.getRepository(Channel);

    await channelDB.insert([service(51, 'original-fifty-one'), service(52, 'removed-fifty-two')], false);
    await channelDB.insert([service(51, 'updated-fifty-one'), service(53, 'new-fifty-three')], true);

    const rows = await repository.find({ order: { id: 'ASC' } });
    assert.deepEqual(
        rows.map(row => [row.id, row.name]),
        [
            [51, 'updated-fifty-one'],
            [53, 'new-fifty-three'],
        ],
    );

    await channelDB.insert([], true);
    assert.equal(await repository.count(), 0);
});
