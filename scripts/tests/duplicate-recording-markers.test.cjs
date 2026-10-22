const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

function loadTypeScript(relativePath) {
    const absolutePath = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    loadedModule._compile(compiled, absolutePath);
    return loadedModule.exports;
}

const { default: StrUtil } = loadTypeScript('../../src/util/StrUtil.ts');

test('前 and 後 remain distinct when normalizing recording names', () => {
    const previousBroadcast = StrUtil.deleteBrackets('連続ドラマ🈜');
    const nextBroadcast = StrUtil.deleteBrackets('連続ドラマ🈝');

    assert.equal(previousBroadcast, '連続ドラマ[前]');
    assert.equal(nextBroadcast, '連続ドラマ[後]');
    assert.notEqual(previousBroadcast, nextBroadcast);
});

test('other bracketed broadcast markers continue to be removed', () => {
    assert.equal(StrUtil.deleteBrackets('番組[字][新][再]'), '番組');
    assert.equal(StrUtil.deleteBrackets('番組🈑🈟🈞'), '番組');
});

test('enclosed Unicode markers and their canonical bracket spellings normalize equally', () => {
    assert.equal(StrUtil.deleteBrackets('番組🈜'), StrUtil.deleteBrackets('番組[前]'));
    assert.equal(StrUtil.deleteBrackets('番組🈝'), StrUtil.deleteBrackets('番組[後]'));
});

test('marker position and removable neighboring markers do not change the normalized name', () => {
    assert.equal(StrUtil.deleteBrackets('[新] 番組🈜'), StrUtil.deleteBrackets('番組[前][再]'));
    assert.equal(StrUtil.deleteBrackets('[再] 番組🈝'), StrUtil.deleteBrackets('番組[後][新]'));
});
