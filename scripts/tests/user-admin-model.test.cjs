const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

const sourcePath = path.resolve(__dirname, '../../src/model/api/user/UserApiModel.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
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
const UserApiModel = loadedModule.exports.default;

function fixture(values) {
    const users = values.map(value => ({ ...value }));
    const calls = { commits: 0, rollbacks: 0, updates: [] };
    const repository = {
        createQueryBuilder: () => ({
            orderBy() {
                return this;
            },
            getMany: async () => users.map(user => ({ ...user })),
        }),
        update: async (userId, update) => {
            calls.updates.push({ userId, update });
            Object.assign(
                users.find(user => user.id === userId),
                update,
            );
        },
    };
    const runner = {
        connection: { options: { type: 'better-sqlite3' } },
        manager: { getRepository: () => repository },
        startTransaction: async () => {},
        commitTransaction: async () => {
            calls.commits += 1;
        },
        rollbackTransaction: async () => {
            calls.rollbacks += 1;
        },
        release: async () => {},
    };
    const model = new UserApiModel({}, { getConnection: async () => ({ createQueryRunner: () => runner }) });
    return { model, users, calls };
}

test('only an admin can grant privileges and the last admin cannot be demoted', async () => {
    const { model, users, calls } = fixture([
        { id: 4, isAdmin: true },
        { id: 9, isAdmin: false },
    ]);
    await assert.rejects(model.updateAdmin(9, 9, { isAdmin: true }), /管理者ユーザー/);
    await assert.rejects(model.updateAdmin(4, 4, { isAdmin: false }), /最後の管理者/);
    assert.deepEqual(calls.updates, []);
    await model.updateAdmin(4, 9, { isAdmin: true });
    await model.updateAdmin(4, 4, { isAdmin: false });
    assert.deepEqual(
        users.map(user => user.isAdmin),
        [false, true],
    );
    assert.equal(calls.commits, 2);
    assert.equal(calls.rollbacks, 2);
});

test('the last admin cannot be deleted even when another normal user remains', async () => {
    const { model, calls } = fixture([
        { id: 4, isAdmin: true },
        { id: 9, isAdmin: false },
    ]);
    await assert.rejects(model.delete(4), /最後の管理者/);
    assert.equal(calls.commits, 0);
    assert.equal(calls.rollbacks, 1);
});
