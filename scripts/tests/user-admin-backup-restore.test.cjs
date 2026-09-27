const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

const sourcePath = path.resolve(__dirname, '../../src/model/db/TvUserDB.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { experimentalDecorators: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath && request.startsWith('.')) return {};
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const TvUserDB = loadedModule.exports.default;

test('restored legacy users without an admin grant the lowest user administrator access', async () => {
    const users = [
        { id: 4, name: 'first', isAdmin: false },
        { id: 9, name: 'second', isAdmin: false },
    ];
    const updates = [];
    const db = new TvUserDB(
        {
            getConnection: async () => ({
                getRepository: () => ({
                    update: async (id, values) => updates.push({ id, values }),
                }),
            }),
        },
        { run: operation => operation() },
    );
    db.findAll = async () => users;
    const first = await db.ensureDefaultUser();
    assert.equal(first.isAdmin, true);
    assert.deepEqual(updates, [{ id: 4, values: { isAdmin: true } }]);
});
