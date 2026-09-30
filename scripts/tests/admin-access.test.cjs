const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/service/api/adminAccess.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const services = {
    ITvUserDB: { findId: async () => ({ id: 4, isAdmin: true }) },
    IViewerProfileDB: { findByTvUserId: async () => null },
    IViewerProfileApiModel: { authenticate: async () => true },
};
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath && request === '../../ModelContainer') {
        return { default: { get: key => services[key] } };
    }
    if (parent?.filename === sourcePath && request === './activeUser') {
        return { getActiveUserId: req => Number(req.header('x-epgstation-user-id') ?? 0) };
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const { requireActiveAdmin } = loadedModule.exports;
const request = headers => ({ header: name => headers[name] });

test('active admin without optional lock may update, but master and non-admin may not', async () => {
    assert.equal(await requireActiveAdmin(request({ 'x-epgstation-user-id': '4' })), 4);
    await assert.rejects(requireActiveAdmin(request({ 'x-epgstation-user-id': '0' })), /管理者ユーザー/);
    services.ITvUserDB.findId = async () => ({ id: 4, isAdmin: false });
    await assert.rejects(requireActiveAdmin(request({ 'x-epgstation-user-id': '4' })), /管理者ユーザー/);
    services.ITvUserDB.findId = async () => ({ id: 4, isAdmin: true });
});

test('locked admin requires the matching profile and valid existing session', async () => {
    services.IViewerProfileDB.findByTvUserId = async () => ({ id: 7, pinSalt: 'salt', pinHash: 'hash' });
    await assert.rejects(requireActiveAdmin(request({ 'x-epgstation-user-id': '4' })), /ロック/);
    await assert.rejects(
        requireActiveAdmin(request({ 'x-epgstation-user-id': '4', 'x-viewer-profile-id': '8' })),
        /ロック/,
    );
    services.IViewerProfileApiModel.authenticate = async (_id, token) => token === 'valid';
    await assert.rejects(
        requireActiveAdmin(request({ 'x-epgstation-user-id': '4', 'x-viewer-profile-id': '7' })),
        /ロック/,
    );
    assert.equal(
        await requireActiveAdmin(
            request({
                'x-epgstation-user-id': '4',
                'x-viewer-profile-id': '7',
                'x-viewer-session': 'valid',
            }),
        ),
        4,
    );
    services.IViewerProfileDB.findByTvUserId = async () => null;
    services.IViewerProfileApiModel.authenticate = async () => true;
});
