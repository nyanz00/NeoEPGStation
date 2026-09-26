const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const configContents = new Map();

function loadLogConfig() {
    const sourcePath = path.resolve(__dirname, '../../src/util/LogConfig.ts');
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
    const fsStub = Object.create(fs);
    fsStub.readFileSync = (filename, encoding) => {
        const resolved = typeof filename === 'string' ? path.resolve(filename) : undefined;
        if (resolved !== undefined && configContents.has(resolved)) return configContents.get(resolved);
        return fs.readFileSync(filename, encoding);
    };
    const load = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === sourcePath && request === 'fs') return fsStub;
        if (parent?.filename === sourcePath && request === '../../api') return {};
        return load.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, sourcePath);
    } finally {
        Module._load = load;
    }
    return loadedModule.exports;
}

const { getConfiguredLogFile, getLogConfigPath, resolveCurrentLogFile } = loadLogConfig();

function setLogConfig(source, content) {
    configContents.set(path.resolve(getLogConfigPath(source)), content);
}

function fileAppenderConfig(filename, extraFields = '', type = 'file') {
    return [
        'appenders:',
        '  logFile:',
        `    type: ${type}`,
        `    filename: ${JSON.stringify(filename)}`,
        ...extraFields.split('\n').filter(line => line.length > 0).map(line => `    ${line}`),
        'categories:',
        '  system:',
        '    appenders:',
        '      - logFile',
        '',
    ].join('\n');
}

test('log configuration paths match each logger source filename', () => {
    assert.equal(path.basename(getLogConfigPath('Operator')), 'operatorLogConfig.yml');
    assert.equal(path.basename(getLogConfigPath('Service')), 'serviceLogConfig.yml');
    assert.equal(path.basename(getLogConfigPath('EPGUpdater')), 'epgUpdaterLogConfig.yml');
});

test('configured file appenders resolve their custom filename', () => {
    const customFile = path.resolve(os.tmpdir(), 'custom operator logs', 'system-output.log');
    setLogConfig('Operator', fileAppenderConfig(customFile));

    assert.deepEqual(getConfiguredLogFile('Operator', 'system'), {
        filename: customFile,
        dateFileWithPattern: false,
        pattern: 'yyyy-MM-dd',
        fileNameSep: '.',
        keepFileExt: false,
    });
});

test('default log placeholders expand to the application log path', () => {
    setLogConfig('Service', fileAppenderConfig('%ServiceSystem%'));

    const configured = getConfiguredLogFile('Service', 'system');

    assert.equal(configured.filename, path.resolve(__dirname, '../../logs/Service/system.log'));
    assert.equal(configured.dateFileWithPattern, false);
});

test('console-only categories report that no file output is configured', () => {
    setLogConfig(
        'EPGUpdater',
        [
            'appenders:',
            '  console:',
            '    type: console',
            'categories:',
            '  system:',
            '    appenders:',
            '      - console',
            '',
        ].join('\n'),
    );

    assert.equal(getConfiguredLogFile('EPGUpdater', 'system'), null);
});

test('dateFile patterns resolve to the most recently modified matching file', async t => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'neo-log-config-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const configuredBase = path.join(directory, 'system.log');
    const olderFile = path.join(directory, 'system-2026-09-22.log');
    const newerFile = path.join(directory, 'system-2026-09-23.log');
    const unrelatedFile = path.join(directory, 'system-2026-09-24.txt');
    const unrelatedBackup = path.join(directory, 'system-backup.log');
    const rotatedFile = path.join(directory, 'system-2026-09-23.1.log');
    await Promise.all([
        fs.promises.writeFile(olderFile, 'older'),
        fs.promises.writeFile(newerFile, 'newer'),
        fs.promises.writeFile(unrelatedFile, 'unrelated'),
        fs.promises.writeFile(unrelatedBackup, 'backup'),
        fs.promises.writeFile(rotatedFile, 'rotated'),
    ]);
    await fs.promises.utimes(olderFile, 1_700_000_000, 1_700_000_000);
    await fs.promises.utimes(newerFile, 1_700_000_010, 1_700_000_010);
    await fs.promises.utimes(unrelatedBackup, 1_700_000_020, 1_700_000_020);
    await fs.promises.utimes(rotatedFile, 1_700_000_030, 1_700_000_030);
    setLogConfig(
        'Operator',
        fileAppenderConfig(
            configuredBase,
            ['alwaysIncludePattern: true', 'fileNameSep: "-"', 'keepFileExt: true'].join('\n'),
            'dateFile',
        ),
    );

    const configured = getConfiguredLogFile('Operator', 'system');

    assert.equal(configured.dateFileWithPattern, true);
    assert.equal(configured.fileNameSep, '-');
    assert.equal(configured.keepFileExt, true);
    assert.equal(await resolveCurrentLogFile(configured), newerFile);
});
