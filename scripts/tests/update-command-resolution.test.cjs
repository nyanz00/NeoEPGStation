'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
        fileName: filename,
    }).outputText;
    module._compile(output, filename);
};

const {
    createUpdateCommandInvocation,
    decodeUpdateCommandOutput,
    resolveUpdatePackageCommand,
} = require('../../src/model/update/UpdateCommand.ts');

test(
    'Windows executes a command shim in a path with spaces and metacharacters and decodes its output',
    { skip: process.platform !== 'win32' },
    async t => {
        const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'neo updater & spaces-'));
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        const file = path.join(directory, 'pnpm test (shim).cmd');
        for (const encoding of ['cp932', 'utf8']) {
            const page = encoding === 'cp932' ? '932' : '65001';
            const script = `@echo off\r\nchcp ${page} >nul\r\necho 日本語\r\n`;
            fs.writeFileSync(file, require('iconv-lite').encode(script, encoding));
            const invocation = createUpdateCommandInvocation(file, ['--version']);
            const result = await require('node:util').promisify(require('node:child_process').execFile)(
                invocation.command,
                invocation.args,
                {
                    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
                    windowsHide: true,
                    encoding: 'buffer',
                    timeout: 5000,
                },
            );
            assert.equal(decodeUpdateCommandOutput(result.stdout), '日本語\r\n');
        }
    },
);
const win32 = path.win32;
const nodeExe = 'C:\\Program Files (x86)\\Node.js & Tools\\node.exe';

const environment = overrides => ({
    PATH: '',
    PNPM_HOME: '',
    APPDATA: '',
    LOCALAPPDATA: '',
    USERPROFILE: '',
    ...overrides,
});

const existingFiles = (...files) => {
    const normalized = new Set(files.map(file => win32.normalize(file).toLowerCase()));
    return file => normalized.has(win32.normalize(file).toLowerCase());
};

const resolveWindows = (command, env, exists, execPath = nodeExe) =>
    resolveUpdatePackageCommand(command, {
        platform: 'win32',
        execPath,
        environment: env,
        exists,
    });

test('prefers npm.cmd beside the active Node.js executable, including paths with spaces and punctuation', () => {
    const expected = win32.join(win32.dirname(nodeExe), 'npm.cmd');
    const pathCandidate = win32.join('C:\\fallback, tools (x86)\\bin', 'npm.cmd');

    assert.equal(
        resolveWindows(
            'npm',
            environment({ PATH: 'C:\\fallback, tools (x86)\\bin' }),
            existingFiles(expected, pathCandidate),
        ),
        expected,
    );
});

test('searches Windows PATH entries in order and keeps spaces and punctuation in directory names', () => {
    const first = win32.join('C:\\tools, with spaces (one)\\bin', 'pnpm.cmd');
    const second = win32.join('D:\\tools & utilities\\bin', 'pnpm.cmd');

    assert.equal(
        resolveWindows(
            'pnpm',
            environment({ PATH: 'C:\\tools, with spaces (one)\\bin;D:\\tools & utilities\\bin' }),
            existingFiles(first, second),
        ),
        first,
    );
});

test('searches Windows package manager install directories after PATH in the documented order', () => {
    const pnpmHome = win32.join('D:\\Package Managers\\pnpm home', 'pnpm.cmd');
    const appDataNpm = win32.join('C:\\Users\\test\\AppData\\Roaming\\npm', 'pnpm.cmd');
    const localAppDataPnpm = win32.join('C:\\Users\\test\\AppData\\Local\\pnpm', 'pnpm.cmd');
    const userProfileNpm = win32.join('C:\\Users\\test\\AppData\\Roaming\\npm', 'pnpm.cmd');
    const env = environment({
        PNPM_HOME: 'D:\\Package Managers\\pnpm home',
        APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
        USERPROFILE: 'C:\\Users\\test',
    });

    assert.equal(
        resolveWindows('pnpm', env, existingFiles(pnpmHome, appDataNpm, localAppDataPnpm, userProfileNpm)),
        pnpmHome,
    );
});

test('prefers APPDATA/npm over LOCALAPPDATA/pnpm and the USERPROFILE fallback', () => {
    const appDataNpm = win32.join('C:\\Roaming data', 'npm', 'npm.cmd');
    const localAppDataPnpm = win32.join('D:\\Local data', 'pnpm', 'npm.cmd');
    const userProfileNpm = win32.join('E:\\Profiles\\test', 'AppData', 'Roaming', 'npm', 'npm.cmd');

    assert.equal(
        resolveWindows(
            'npm',
            environment({
                APPDATA: 'C:\\Roaming data',
                LOCALAPPDATA: 'D:\\Local data',
                USERPROFILE: 'E:\\Profiles\\test',
            }),
            existingFiles(appDataNpm, localAppDataPnpm, userProfileNpm),
        ),
        appDataNpm,
    );
});

test('resolves each configured Windows package manager fallback directory', () => {
    const cases = [
        {
            env: environment({ PNPM_HOME: 'D:\\pnpm root' }),
            expected: win32.join('D:\\pnpm root', 'pnpm.cmd'),
        },
        {
            env: environment({ APPDATA: 'C:\\Users\\test\\AppData\\Roaming' }),
            expected: win32.join('C:\\Users\\test\\AppData\\Roaming\\npm', 'npm.cmd'),
        },
        {
            env: environment({ LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }),
            expected: win32.join('C:\\Users\\test\\AppData\\Local\\pnpm', 'npm.cmd'),
        },
        {
            env: environment({ USERPROFILE: 'C:\\Users\\test' }),
            expected: win32.join('C:\\Users\\test\\AppData\\Roaming\\npm', 'npm.cmd'),
        },
    ];

    for (const { env, expected } of cases) {
        assert.equal(
            resolveWindows(expected.endsWith('pnpm.cmd') ? 'pnpm' : 'npm', env, existingFiles(expected)),
            expected,
        );
    }
});

test('reports a missing Windows package manager with a Japanese error before updater switching', () => {
    assert.throws(
        () => resolveWindows('npm', environment({}), () => false),
        error => error instanceof Error && /見つかりません/.test(error.message),
    );
});

test('returns the package manager name unchanged on non-Windows platforms', () => {
    let checked = false;
    const exists = () => {
        checked = true;
        return false;
    };

    assert.equal(
        resolveUpdatePackageCommand('pnpm', {
            platform: 'linux',
            execPath: '/usr/bin/node',
            environment: environment({ PATH: '/usr/local/bin' }),
            exists,
        }),
        'pnpm',
    );
    assert.equal(checked, false);
});

test('keeps valid UTF-8 output unchanged on Windows and other platforms', () => {
    const validUtf8 = Buffer.from('更新に失敗しました', 'utf8');

    assert.equal(decodeUpdateCommandOutput(validUtf8, 'win32'), '更新に失敗しました');
    assert.equal(decodeUpdateCommandOutput('すでに文字列', 'win32'), 'すでに文字列');
    assert.equal(decodeUpdateCommandOutput(validUtf8, 'linux'), '更新に失敗しました');
    assert.equal(decodeUpdateCommandOutput(undefined, 'win32'), '');
});

test('decodes invalid Windows UTF-8 output as CP932 and uses UTF-8 elsewhere', () => {
    const cp932Bytes = Buffer.from([0x82, 0xa0]);

    assert.equal(decodeUpdateCommandOutput(cp932Bytes, 'win32'), 'あ');
    assert.equal(decodeUpdateCommandOutput(cp932Bytes, 'linux'), '\ufffd\ufffd');
});
