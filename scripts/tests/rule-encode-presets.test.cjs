const assert = require('node:assert/strict');
const test = require('node:test');
require('reflect-metadata');
const RuleManageModel = require('../../dist/model/operator/rule/RuleManageModel').default;
const ReserveOptionChecker = require('../../dist/model/operator/ReserveOptionChecker').default;
const RuleDB = require('../../dist/model/db/RuleDB').default;

function rule(id = 1) {
    return {
        id,
        isTimeSpecification: false,
        searchOption: { keyword: 'test', name: true, channelIds: [400151], genres: [{ genre: 7 }] },
        reserveOption: { enable: true, allowEndLack: true, avoidDuplicate: false },
        encodeOption: {
            mode1: 'removed',
            channelId1: 400151,
            channelIds1: [400151],
            encodeParentDirectoryName1: 'recorded',
            directory1: 'old',
            isDeleteOriginalAfterEncode: true,
            updateThumbnail: true,
            startDelayMinutes: 5,
        },
    };
}

function setup(rules = [rule()]) {
    const items = new Map(rules.map(item => [item.id, structuredClone(item)]));
    const events = [];
    const writes = [];
    const config = { encode: [{ name: 'keep' }] };
    const configure = { getConfig: () => config };
    const checker = new ReserveOptionChecker(configure);
    const db = {
        getIds: async () => [...items.keys()],
        findId: async id => structuredClone(items.get(id) ?? null),
        updateOnce: async item => {
            writes.push(structuredClone(item));
            items.set(item.id, structuredClone(item));
        },
    };
    const logger = { getLogger: () => ({ system: { info() {}, error() {} } }) };
    const model = new RuleManageModel(logger, checker, db, { emitUpdated: id => events.push(id) }, configure);
    return { model, items, config, db, checker, events, writes };
}

test('a genre edit with channel selection succeeds after its preset has been removed', async () => {
    const state = setup();
    const edited = rule();
    assert.equal(state.checker.checkRuleOption(edited), false);
    await state.model.update(edited);
    const saved = state.items.get(1);
    assert.equal(saved.encodeOption, undefined);
    assert.deepEqual(saved.searchOption, edited.searchOption);
    assert.deepEqual(state.events, [1]);
    // Exercise the real persistence conversion: all old encoding columns must be cleared.
    const converted = new RuleDB({}, {}).convertRuleToDBRule(saved);
    for (const slot of [1, 2, 3]) {
        for (const field of ['mode', 'encodeChannelId', 'encodeChannelIds', 'parentDirectoryName', 'directory']) {
            assert.equal(converted[`${field}${slot}`], null);
        }
    }
    assert.equal(converted.isDeleteOriginalAfterEncode, false);
    assert.equal(converted.updateThumbnail, false);
    assert.equal(converted.encodeStartDelayMinutes, 0);
});

test('automatic cleanup preserves valid slots and is idempotent, including disabled rules', async () => {
    const item = rule();
    item.reserveOption.enable = false;
    Object.assign(item.encodeOption, {
        mode2: 'keep',
        channelIds2: [400152],
        encodeParentDirectoryName2: 'recorded',
        directory2: 'keep-dir',
        mode3: 'removed-too',
        channelIds3: [400153],
        directory3: 'old-dir',
    });
    const state = setup([item]);
    await state.model.removeMissingEncodePresets();
    assert.deepEqual(state.items.get(1).encodeOption, {
        mode2: 'keep',
        channelIds2: [400152],
        encodeParentDirectoryName2: 'recorded',
        directory2: 'keep-dir',
        isDeleteOriginalAfterEncode: true,
        updateThumbnail: true,
        startDelayMinutes: 5,
    });
    await state.model.removeMissingEncodePresets();
    assert.equal(state.writes.length, 1);
    assert.deepEqual(state.events, [1]);
    // A later config reload removes the remaining preset as well.
    state.config.encode = [];
    await state.model.removeMissingEncodePresets();
    assert.equal(state.items.get(1).encodeOption, undefined);
    assert.deepEqual(state.events, [1, 1]);
});

test('valid encodes and rules without encodes are untouched', async () => {
    const first = rule();
    first.encodeOption.mode1 = 'keep';
    const second = rule(2);
    delete second.encodeOption;
    const state = setup([first, second]);
    await state.model.removeMissingEncodePresets();
    assert.deepEqual([...state.items.values()], [first, second]);
    assert.equal(state.writes.length, 0);
});

test('malformed preset collections do not erase persisted selections', async () => {
    const state = setup();
    state.config.encode = null;
    await state.model.removeMissingEncodePresets();
    assert.equal(state.writes.length, 0);
});

test('a failed rule does not block cleanup of other rules or later retries', async () => {
    const state = setup([rule(), rule(2)]);
    const write = state.db.updateOnce;
    state.db.updateOnce = async item => {
        if (item.id === 1) throw new Error('test write failure');
        return write(item);
    };
    await state.model.removeMissingEncodePresets();
    assert.equal(state.items.get(1).encodeOption.mode1, 'removed');
    assert.equal(state.items.get(2).encodeOption, undefined);
    assert.deepEqual(state.events, [2]);
    state.db.updateOnce = write;
    await state.model.removeMissingEncodePresets();
    assert.equal(state.items.get(1).encodeOption, undefined);
});

test('cleanup and a concurrent genre update cannot overwrite each other', async () => {
    const state = setup();
    const find = state.db.findId;
    let resume;
    let entered;
    const reading = new Promise(resolve => {
        entered = resolve;
    });
    const gate = new Promise(resolve => {
        resume = resolve;
    });
    let first = true;
    state.db.findId = async id => {
        const value = await find(id);
        if (first) {
            first = false;
            entered();
            await gate;
        }
        return value;
    };
    const cleanup = state.model.removeMissingEncodePresets();
    await reading;
    const edit = rule();
    edit.searchOption.genres = [{ genre: 6 }];
    const update = state.model.update(edit);
    resume();
    await Promise.all([cleanup, update]);
    assert.deepEqual(state.items.get(1).searchOption.genres, [{ genre: 6 }]);
    assert.equal(state.items.get(1).encodeOption, undefined);
});

test('validation exceptions release the mutation lock', async () => {
    const state = setup();
    const check = state.checker.checkRuleOption.bind(state.checker);
    state.checker.checkRuleOption = () => {
        throw new Error('test validation failure');
    };
    await assert.rejects(state.model.update(rule()), /test validation failure/);
    state.checker.checkRuleOption = check;
    await state.model.update(rule());
    assert.equal(state.items.get(1).encodeOption, undefined);
});

test('successful config reloads detach presets; unreadable config keeps the previous rules', async t => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const Configuration = require('../../dist/model/Configuration').default;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-rule-presets-'));
    const originalPath = Configuration.CONFIG_FILE_PATH;
    const originalTemplatePath = Configuration.CONFIG_TEMPLATE_FILE_PATH;
    t.after(() => {
        Configuration.CONFIG_FILE_PATH = originalPath;
        Configuration.CONFIG_TEMPLATE_FILE_PATH = originalTemplatePath;
        fs.rmSync(directory, { recursive: true, force: true });
    });
    Configuration.CONFIG_FILE_PATH = path.join(directory, 'config.yml');
    Configuration.CONFIG_TEMPLATE_FILE_PATH = path.join(directory, 'template.yml');
    const writeConfig = encode =>
        fs.writeFileSync(Configuration.CONFIG_FILE_PATH, JSON.stringify({ port: 8888, encode }));
    writeConfig([{ name: 'removed' }]);
    let reload;
    t.mock.method(fs, 'watchFile', (_file, callback) => {
        reload = callback;
    });
    const logger = { getLogger: () => ({ system: { info() {}, warn() {}, error() {}, fatal() {} } }) };
    const configure = new Configuration(logger);
    const state = setup();
    state.model.configure = configure;
    configure.onUpdated(() => state.model.removeMissingEncodePresets());
    await state.model.removeMissingEncodePresets();
    assert.equal(state.writes.length, 0);
    fs.writeFileSync(Configuration.CONFIG_FILE_PATH, 'encode: [');
    await reload();
    assert.equal(state.writes.length, 0);
    writeConfig([]);
    await reload();
    assert.equal(state.items.get(1).encodeOption, undefined);
    assert.deepEqual(state.events, [1]);
});
