const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

function compile(relativePath, transform = source => source) {
    const filename = path.resolve(__dirname, '../..', relativePath);
    const output = ts.transpileModule(transform(fs.readFileSync(filename, 'utf8')), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    loaded._compile(output, filename);
    return loaded.exports.default;
}

const StrUtil = compile('src/util/StrUtil.ts');
const originalLoad = Module._load;
let V1MigrationTool;
Module._load = function (request, parent, isMain) {
    if (parent?.filename.endsWith(`${path.sep}V1MigrationTool.ts`)) {
        if (request.endsWith('/util/StrUtil')) return { __esModule: true, default: StrUtil };
        if (request.endsWith('/ModelContainerSetter')) return { set() {} };
        if (request.startsWith('.')) return { __esModule: true, default: class {} };
        if (request === 'source-map-support') return { install() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    V1MigrationTool = compile('src/V1MigrationTool.ts', source =>
        source.replace('new V1MigrationTool().run();', 'export default V1MigrationTool;'),
    );
} finally {
    Module._load = originalLoad;
}

test('v1 recorded conversion preserves original extended text and stores a separate half-width value', () => {
    const tool = Object.create(V1MigrationTool.prototype);
    const old = {
        ruleId: null,
        programId: 1,
        name: '番組 Ａ',
        description: '説明 Ｂ',
        extended: '番組詳細 ＡＢＣ１２３〜',
        recPath: null,
        thumbnailPath: null,
    };
    const { recorded } = tool.convertOldRecordedToRecorded(old, 'Recorded', {});
    assert.equal(recorded.extended, old.extended);
    assert.equal(recorded.halfWidthExtended, '番組詳細 ABC123~');
    assert.equal(recorded.description, old.description);
    assert.equal(recorded.halfWidthDescription, '説明 B');
    assert.equal(old.extended, '番組詳細 ＡＢＣ１２３〜');
});
