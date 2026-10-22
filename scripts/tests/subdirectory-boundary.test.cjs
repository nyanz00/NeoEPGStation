const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScript(relativePath) {
    const absolutePath = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const loaded = new Module(absolutePath, module);
    loaded.filename = absolutePath;
    loaded.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    loaded._compile(compiled, absolutePath);
    return loaded.exports;
}

const { isSubDirectoryInsideRoot, safeSubDirectory } = loadTypeScript('../../src/util/SubDirectoryUtil.ts');

test('POSIX traversal and NUL paths are rejected while ordinary normalization stays inside root', () => {
    for (const value of ['../outside', 'a/../../outside', 'a/../../', '\0']) {
        assert.equal(isSubDirectoryInsideRoot(value, path.posix), false, value);
    }
    assert.equal(isSubDirectoryInsideRoot('a/../b', path.posix), true);
    assert.equal(isSubDirectoryInsideRoot('/recordings', path.posix), true);
    assert.equal(safeSubDirectory('../outside'), '');
    assert.equal(safeSubDirectory('a/../b'), 'a/../b');
    assert.equal(safeSubDirectory('/recordings'), 'recordings');
});

test('Windows traversal, drive-relative paths, and NUL are rejected', () => {
    for (const value of ['..\\outside', 'a\\..\\..\\outside', 'C:..\\outside', '\0']) {
        assert.equal(isSubDirectoryInsideRoot(value, path.win32), false, value);
    }
    assert.equal(isSubDirectoryInsideRoot('a\\..\\b', path.win32), true);
    assert.equal(isSubDirectoryInsideRoot('\\recordings', path.win32), true);
    assert.equal(isSubDirectoryInsideRoot('C:\\recordings', path.win32), false);
});
