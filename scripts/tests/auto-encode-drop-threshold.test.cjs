const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');

function loadTypeScript(relativePath) {
    const filename = path.join(root, relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2019,
            experimentalDecorators: true,
        },
    }).outputText;
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === 'inversify') {
            return {
                inject: () => () => {},
                injectable: () => target => target,
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loaded._compile(output, filename);
    } finally {
        Module._load = originalLoad;
    }
    return loaded.exports.default;
}

const AutoEncodeSettingsModel = loadTypeScript('src/model/encode/AutoEncodeSettingsModel.ts');
const EventSetter = loadTypeScript('src/model/event/EventSetter.ts');

function makeSettingsModel(settingsPath, config = { isEnabledDropCheck: false }) {
    const model = new AutoEncodeSettingsModel({ getConfig: () => config });
    Object.defineProperty(model, 'settingsPath', { value: settingsPath, configurable: true });
    return model;
}

function makeEventSetter(autoEncodeSettings, calls, errors) {
    let finishRecording;
    const event = new Proxy(
        {},
        {
            get: (_target, property) => callback => {
                if (property === 'setFinishRecording') finishRecording = callback;
            },
        },
    );
    const logger = {
        getLogger: () => ({
            system: {
                info: message => calls.push(['log.info', message]),
                error: message => errors.push(message),
                fatal: message => calls.push(['log.fatal', message]),
                warn: message => calls.push(['log.warn', message]),
            },
        }),
    };
    const methods = new Proxy(
        {},
        {
            get: (_target, property) => (...args) => {
                calls.push([String(property), ...args]);
                if (['cancel', 'updateRule', 'matchRecordedEpisode'].includes(String(property))) {
                    return Promise.resolve();
                }
            },
        },
    );
    const configuration = { getConfig: () => ({ recorded: [{ name: 'Recorded' }] }) };
    const setter = new EventSetter(
        logger,
        methods,
        methods,
        methods,
        methods,
        event,
        methods,
        methods,
        methods,
        methods,
        methods,
        methods,
        methods,
        methods,
        methods,
        methods,
        methods,
        methods,
        configuration,
        methods,
        autoEncodeSettings,
    );
    setter.set();
    assert.equal(typeof finishRecording, 'function');
    return finishRecording;
}

function makeReserve(overrides = {}) {
    return {
        id: 12,
        ruleId: null,
        isEventRelay: false,
        encodeStartDelayMinutes: 5,
        encodeMode1: 1,
        encodeMode2: 2,
        encodeMode3: 3,
        encodeParentDirectoryName1: null,
        encodeDirectory1: null,
        encodeParentDirectoryName2: 'Second parent',
        encodeDirectory2: 'second',
        encodeParentDirectoryName3: null,
        encodeDirectory3: 'third',
        isDeleteOriginalAfterEncode: true,
        updateThumbnail: true,
        tags: null,
        ...overrides,
    };
}

function makeRecorded(dropCnt) {
    return {
        id: 42,
        dropLogFile:
            dropCnt === 'undefined'
                ? undefined
                : dropCnt === null
                  ? null
                  : { dropCnt, errorCnt: 999, scramblingCnt: 999 },
        videoFiles: [{ id: 314 }],
    };
}

test('automatic encode drop threshold persists, validates, serializes writes, and retries after a failed write', async t => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'auto-encode-settings-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const settingsPath = path.join(directory, 'auto-encode-settings.json');
    const config = { isEnabledDropCheck: false };
    const model = makeSettingsModel(settingsPath, config);

    assert.deepEqual(await model.getSettings(), { dropThreshold: null, dropCheckEnabled: false });
    config.isEnabledDropCheck = true;
    assert.deepEqual(await model.getSettings(), { dropThreshold: null, dropCheckEnabled: true });
    assert.deepEqual(await model.updateSettings({ dropThreshold: 37 }), {
        dropThreshold: 37,
        dropCheckEnabled: true,
    });
    assert.deepEqual(await makeSettingsModel(settingsPath).getSettings(), {
        dropThreshold: 37,
        dropCheckEnabled: false,
    });
    await model.updateSettings({ dropThreshold: null });
    assert.equal((await model.getSettings()).dropThreshold, null);

    for (const value of [0, -1, 1.25, '37', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
        await assert.rejects(model.updateSettings({ dropThreshold: value }));
    }

    await fs.promises.writeFile(settingsPath, '{broken', 'utf8');
    await assert.rejects(model.getSettings(), SyntaxError);
    for (const saved of ['{}', '{"dropThreshold":0}', '{"dropThreshold":"37"}']) {
        await fs.promises.writeFile(settingsPath, saved, 'utf8');
        await assert.rejects(model.getSettings());
    }

    const originalReadFile = fs.promises.readFile;
    fs.promises.readFile = async function (filename, ...args) {
        if (filename === settingsPath) {
            const error = new Error('simulated read failure');
            error.code = 'EIO';
            throw error;
        }
        return originalReadFile.call(this, filename, ...args);
    };
    try {
        await assert.rejects(model.getSettings(), error => error.code === 'EIO');
    } finally {
        fs.promises.readFile = originalReadFile;
    }

    await model.updateSettings({ dropThreshold: 8 });
    const originalRename = fs.promises.rename;
    let failOnce = true;
    fs.promises.rename = async function (...args) {
        if (failOnce && args[1] === settingsPath) {
            failOnce = false;
            const error = new Error('simulated write failure');
            error.code = 'EIO';
            throw error;
        }
        return originalRename.apply(this, args);
    };
    try {
        await assert.rejects(model.updateSettings({ dropThreshold: 9 }), error => error.code === 'EIO');
    } finally {
        fs.promises.rename = originalRename;
    }
    await model.updateSettings({ dropThreshold: 10 });

    await Promise.all([11, 12, 13, 14].map(dropThreshold => model.updateSettings({ dropThreshold })));
    assert.deepEqual(JSON.parse(await fs.promises.readFile(settingsPath, 'utf8')), { dropThreshold: 14 });
    assert.equal((await model.getSettings()).dropThreshold, 14);
});

test('recording completion applies threshold boundaries and fresh settings while keeping completion work intact', async t => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'auto-encode-finish-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const dropCheckConfig = { isEnabledDropCheck: true };
    const settings = makeSettingsModel(path.join(directory, 'auto-encode-settings.json'), dropCheckConfig);
    await settings.updateSettings({ dropThreshold: 100 });
    const calls = [];
    const errors = [];
    const finish = makeEventSetter(settings, calls, errors);
    const execute = async (dropCnt, reserve = makeReserve()) => {
        calls.length = 0;
        errors.length = 0;
        await finish(reserve, makeRecorded(dropCnt), true, 'success');
        return calls.slice();
    };
    const encodeCalls = output => output.filter(([name]) => name === 'setEncode');

    const below = await execute(99);
    assert.equal(encodeCalls(below).length, 3);
    const firstEncode = encodeCalls(below)[0][1];
    assert.equal(firstEncode.mode, 1);
    assert.equal(firstEncode.removeOriginal, true);
    assert.equal(firstEncode.updateThumbnail, true);
    assert.equal(firstEncode.parentDir, 'Recorded');
    assert.equal(firstEncode.directory, undefined);
    assert.ok(firstEncode.scheduledAt >= Date.now() + 4 * 60 * 1000);
    assert.equal(encodeCalls(below)[1][1].parentDir, 'Second parent');
    assert.equal(encodeCalls(below)[1][1].directory, 'second');
    assert.equal(encodeCalls(below)[2][1].directory, 'third');

    const at = await execute(100);
    assert.equal(encodeCalls(at).length, 0);
    assert.ok(at.some(([name]) => name === 'add' && name !== 'setEncode'));
    assert.ok(at.some(([name]) => name === 'enqueue'));
    assert.ok(at.some(([name]) => name === 'addRecordingFinishCmd'));
    assert.ok(at.some(([name]) => name === 'notifyRecordingFinish'));
    assert.ok(at.some(([name]) => name === 'notifyClient'));
    assert.equal(at.some(([name]) => name === 'setEncode'), false);

    assert.equal(encodeCalls(await execute(101)).length, 0);
    assert.equal(encodeCalls(await execute(1, makeReserve({ encodeMode1: 1, encodeMode2: null, encodeMode3: null }))).length, 1);
    assert.equal(encodeCalls(await execute(null)).length, 3);
    assert.equal(encodeCalls(await execute('undefined')).length, 3);
    await settings.updateSettings({ dropThreshold: null });
    assert.equal(encodeCalls(await execute(1000)).length, 3);
    await settings.updateSettings({ dropThreshold: 100 });
    assert.equal(encodeCalls(await execute(100)).length, 0, 'a changed setting applies to the next finish callback');

    const noEncodeModes = await execute(100, makeReserve({ encodeMode1: null, encodeMode2: null, encodeMode3: null }));
    assert.equal(errors.length, 0);
    assert.equal(encodeCalls(noEncodeModes).length, 0);
});

test('a settings read failure logs and skips auto encoding but lets recording completion finish', async () => {
    const calls = [];
    const errors = [];
    const finish = makeEventSetter(
        { getSettings: async () => { throw new Error('settings unavailable'); } },
        calls,
        errors,
    );
    await finish(makeReserve(), makeRecorded(0), true, 'success');

    assert.equal(calls.filter(([name]) => name === 'setEncode').length, 0);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /failed to read automatic encode settings/);
    assert.ok(calls.some(([name]) => name === 'enqueue'));
    assert.ok(calls.some(([name]) => name === 'addRecordingFinishCmd'));
    assert.ok(calls.some(([name]) => name === 'notifyRecordingFinish'));
    assert.ok(calls.some(([name]) => name === 'notifyClient'));
});
