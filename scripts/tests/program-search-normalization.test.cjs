const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const Database = require('better-sqlite3');
const { DataSource } = require('typeorm');
require('reflect-metadata');

function loadTypeScript(relativePath, parentModule = module) {
    const filename = path.resolve(__dirname, '../..', relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
        fileName: filename,
    }).outputText;
    const loadedModule = new Module(filename, parentModule);
    loadedModule.filename = filename;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(filename));
    loadedModule._compile(compiled, filename);
    return loadedModule.exports.default;
}

const StrUtil = loadTypeScript('src/util/StrUtil.ts');
const DBUtil = loadTypeScript('src/model/db/DBUtil.ts');
const Program = loadTypeScript('src/db/entities/Program.ts');
const programDBPath = path.resolve(__dirname, '../../src/model/db/ProgramDB.ts');
const compiledProgramDB = ts.transpileModule(fs.readFileSync(programDBPath, 'utf8'), {
    compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
    fileName: programDBPath,
}).outputText;
const programDBModule = new Module(programDBPath, module);
programDBModule.filename = programDBPath;
programDBModule.paths = Module._nodeModulePaths(path.dirname(programDBPath));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === programDBPath) {
        if (request === '../../util/StrUtil') return { __esModule: true, default: StrUtil };
        if (request === '../../util/DateUtil') {
            return {
                __esModule: true,
                default: { getJaDate: () => ({ getHours: () => 0, getDay: () => 0 }) },
            };
        }
        if (request === '../../util/ChannelTypeUtil') {
            return { __esModule: true, default: { getRuleChannelTypes: () => [] } };
        }
        if (request === '../../db/entities/Program') return { __esModule: true, default: Program };
        if (request === './DBUtil') return { __esModule: true, default: DBUtil };
        if (request.startsWith('.')) return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    programDBModule._compile(compiledProgramDB, programDBPath);
} finally {
    Module._load = originalLoad;
}
const ProgramDB = programDBModule.exports.default;

function createProgramDB(operatorOverrides = {}) {
    const operator = {
        isEnableCS: () => true,
        isEnabledRegexp: () => true,
        getLikeStr: () => 'LIKE',
        getRegexpStr: () => 'REGEXP',
        ...operatorOverrides,
    };
    return new ProgramDB(
        { getLogger: () => ({ system: { error: () => {} } }) },
        { getConfig: () => ({ needToReplaceEnclosingCharacters: false, dbtype: 'better-sqlite3' }) },
        operator,
        { run: operation => operation() },
    );
}

function normalizeSearch(value) {
    assert.equal(typeof StrUtil.normalizeSearch, 'function', 'StrUtil.normalizeSearch must be available');
    return StrUtil.normalizeSearch(value);
}

function createProgramTable(rows) {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE program (
            id INTEGER PRIMARY KEY,
            halfWidthName TEXT,
            halfWidthDescription TEXT,
            halfWidthExtended TEXT,
            normalizedName TEXT,
            normalizedDescription TEXT,
            normalizedExtended TEXT
        )
    `);
    const insert = db.prepare(`
        INSERT INTO program (
            id, halfWidthName, halfWidthDescription, halfWidthExtended,
            normalizedName, normalizedDescription, normalizedExtended
        ) VALUES (
            @id, @halfWidthName, @halfWidthDescription, @halfWidthExtended,
            @normalizedName, @normalizedDescription, @normalizedExtended
        )
    `);
    for (const row of rows) insert.run(row);
    db.function('REGEXP', (pattern, value) => {
        if (value === null || typeof value === 'undefined') return 0;
        return new RegExp(pattern).test(value) ? 1 : 0;
    });
    return db;
}

function normalizedRow(id, { name = '', description = null, extended = null } = {}) {
    return {
        id,
        halfWidthName: StrUtil.toHalf(name),
        halfWidthDescription: description === null ? null : StrUtil.toHalf(description),
        halfWidthExtended: extended === null ? null : StrUtil.toHalf(extended),
        normalizedName: normalizeSearch(name),
        normalizedDescription: description === null ? null : normalizeSearch(description),
        normalizedExtended: extended === null ? null : normalizeSearch(extended),
    };
}

function findKeyword(db, keyword, option, valueBaseName = 'keyword', isIgnore = false) {
    const query = { strs: [], param: {} };
    createProgramDB().setKeywordOption(keyword, option, valueBaseName, isIgnore, query);
    const where = query.strs.at(-1);
    const rows = db.prepare(`SELECT id FROM program WHERE ${where} ORDER BY id`).all(query.param);
    return { ids: rows.map(row => row.id), where, params: query.param };
}

const onlyName = { cs: false, regexp: false, name: true, description: false, extended: false };

test('search normalization keeps legacy half-width conversion and adds compatibility normalization', () => {
    assert.equal(StrUtil.toHalf('ＩＩ'), 'II');
    assert.equal(normalizeSearch('Ⅱ'), 'II');
    assert.equal(normalizeSearch('II'), 'II');
    assert.equal(normalizeSearch('が'), normalizeSearch('か\u3099'));
    assert.equal(normalizeSearch('①'), normalizeSearch('1'));
    assert.equal(normalizeSearch('〜'), normalizeSearch('～'));
    assert.equal(normalizeSearch('”’‘'), normalizeSearch('"\'`'));
    assert.equal(normalizeSearch('ＡＢＣ！　〜'), 'ABC! ~');
});

test('ordinary name search matches Roman numeral variants in both query directions', () => {
    const db = createProgramTable([
        normalizedRow(1, { name: '転生したら剣でしたⅡ' }),
        normalizedRow(2, { name: '転生したら剣でしたII' }),
    ]);
    try {
        assert.deepEqual(findKeyword(db, '転生したら剣でしたII', onlyName).ids, [1, 2]);
        assert.deepEqual(findKeyword(db, '転生したら剣でしたⅡ', onlyName).ids, [1, 2]);
    } finally {
        db.close();
    }
});

test('ordinary search covers kana, circles, description, extended text, and multiple required terms', () => {
    const db = createProgramTable([
        normalizedRow(1, { name: 'がっこう ①' }),
        normalizedRow(2, { description: '新作映画 とくべつ版' }),
        normalizedRow(3, { extended: '◇出演者\n田中 Ⅱ' }),
        normalizedRow(4, { name: '新作 映画' }),
        normalizedRow(5, { description: '新作だけ' }),
    ]);
    try {
        assert.deepEqual(findKeyword(db, 'か\u3099っこう 1', onlyName).ids, [1]);
        assert.deepEqual(
            findKeyword(db, '映画 新作', {
                ...onlyName,
                name: false,
                description: true,
            }).ids,
            [2],
        );
        assert.deepEqual(
            findKeyword(db, '田中 II', {
                ...onlyName,
                name: false,
                extended: true,
            }).ids,
            [3],
        );
        assert.deepEqual(
            findKeyword(db, '新作 映画', {
                ...onlyName,
                description: true,
            }).ids,
            [2, 4],
        );
    } finally {
        db.close();
    }
});

test('exclude search removes Roman numeral variants after normalization', () => {
    const db = createProgramTable([
        normalizedRow(1, { name: 'Ⅱ期' }),
        normalizedRow(2, { name: 'II期' }),
        normalizedRow(3, { name: 'IV期' }),
    ]);
    try {
        const option = { ...onlyName, extended: false };
        assert.deepEqual(findKeyword(db, 'II', option, 'ignoreKeyword', true).ids, [3]);
        assert.deepEqual(findKeyword(db, 'Ⅱ', option, 'ignoreKeyword', true).ids, [3]);
    } finally {
        db.close();
    }
});

test('regular-expression search keeps the raw pattern and legacy half-width columns', () => {
    const db = createProgramTable([normalizedRow(1, { name: 'Ⅱ期' }), normalizedRow(2, { name: 'II期' })]);
    try {
        const roman = findKeyword(db, 'Ⅱ', { ...onlyName, regexp: true });
        assert.deepEqual(roman.ids, [1]);
        assert.equal(roman.params.keywordRegexp, 'Ⅱ');
        assert.match(roman.where, /halfWidthName/);
        assert.doesNotMatch(roman.where, /normalizedName/);

        const legacy = findKeyword(db, 'II', { ...onlyName, regexp: true });
        assert.deepEqual(legacy.ids, [2]);
        assert.equal(legacy.params.keywordRegexp, 'II');
    } finally {
        db.close();
    }
});

test('program conversion preserves display and short names while saving normalized search fields', () => {
    const programDB = createProgramDB();
    const program = {
        id: 10,
        networkId: 1,
        serviceId: 2,
        eventId: 3,
        startAt: 1_800_000_000_000,
        duration: 3_600_000,
        isFree: true,
        name: '［Ⅱ］　Ａｎｉｍｅ',
        description: 'が ① ”Special’‘',
        extended: { Info: '◇Ⅱ期 〜' },
    };
    const value = programDB.createProgramValue(
        { 1: { 2: { id: 20, type: 'GR', channel: 'Test' } } },
        program,
        1_800_000_000_001,
    );

    assert.equal(value.name, program.name);
    assert.equal(value.shortName, 'Anime');
    assert.equal(value.halfWidthName, '[Ⅱ] Anime');
    assert.equal(value.normalizedName, normalizeSearch(program.name));
    assert.equal(value.description, program.description);
    assert.equal(value.halfWidthDescription, 'が ① "Special\'`');
    assert.equal(value.normalizedDescription, normalizeSearch(program.description));
    assert.equal(value.normalizedExtended, normalizeSearch(value.extended));
    assert.equal(value.extended, '◇Info\n◇Ⅱ期 〜');
});

test('SQLite persistence, search, and reconcile keep normalized fields synchronized', async () => {
    const dataSource = new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
        entities: [Program],
        synchronize: true,
    });
    await dataSource.initialize();
    try {
        const programDB = createProgramDB({ getConnection: async () => dataSource });
        const channelTypes = { 1: { 2: { id: 20, type: 'GR', channel: 'Test' } } };
        const startAt = Date.now() + 60 * 60 * 1000;
        const makeProgram = (id, name, description, extended) => ({
            id,
            networkId: 1,
            serviceId: 2,
            eventId: id,
            startAt,
            duration: 30 * 60 * 1000,
            isFree: true,
            name,
            description,
            extended: { Info: extended },
        });
        const programs = [
            makeProgram(1, 'Ⅱ期', '初期情報', '① 詳細'),
            makeProgram(2, 'II期', '第二情報', '② 詳細'),
            makeProgram(3, 'ｶﾞイド', '半角カナ', '案内'),
            makeProgram(4, 'ガイド', '全角カナ', '案内'),
        ];
        const findByKeyword = async (keyword, fields) => {
            const results = await programDB.findRule({
                searchOption: { keyword, channelIds: [20], ...fields },
                limit: 100,
            });
            return results.map(program => Number(program.id));
        };

        await programDB.insert(channelTypes, programs);

        assert.deepEqual(await findByKeyword('II', { name: true }), [1, 2]);
        assert.deepEqual(await findByKeyword('Ⅱ', { name: true }), [1, 2]);
        assert.deepEqual(await findByKeyword('ｶﾞ', { name: true }), [3, 4]);
        assert.deepEqual(await findByKeyword('ガ', { name: true }), [3, 4]);

        const stored = await programDB.findId(1);
        assert.equal(stored.name, 'Ⅱ期');
        assert.equal(stored.halfWidthName, 'Ⅱ期');
        assert.equal(stored.normalizedName, undefined);
        assert.equal(stored.normalizedDescription, undefined);
        assert.equal(stored.normalizedExtended, undefined);

        const firstUpdateTime = stored.updateTime;
        const unchanged = await programDB.reconcile(channelTypes, programs);
        assert.deepEqual(unchanged, { deleteValues: 0, insertValues: 0, updateValues: 0, unchangedValues: 4 });
        assert.equal((await programDB.findId(1)).updateTime, firstUpdateTime);

        const changedPrograms = programs.map(program =>
            program.id === 1 ? makeProgram(1, 'Ⅱ期 改', 'ｶﾞ 描写', '② 詳細') : program,
        );
        const changed = await programDB.reconcile(channelTypes, changedPrograms);
        assert.deepEqual(changed, { deleteValues: 0, insertValues: 0, updateValues: 1, unchangedValues: 3 });
        assert.deepEqual(await findByKeyword('改', { name: true }), [1]);
        assert.deepEqual(await findByKeyword('ガ 描写', { description: true }), [1]);
        assert.deepEqual(await findByKeyword('2 詳細', { extended: true }), [1, 2]);

        const updated = await programDB.findId(1);
        assert.equal(updated.name, 'Ⅱ期 改');
        assert.equal(updated.description, 'ｶﾞ 描写');
        assert.equal(updated.extended, '◇Info\n② 詳細');
        assert.equal(updated.normalizedName, undefined);
    } finally {
        await dataSource.destroy();
    }
});
