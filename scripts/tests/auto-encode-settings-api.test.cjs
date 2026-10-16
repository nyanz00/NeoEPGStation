const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const { after, before, test } = require('node:test');
const Ajv = require('ajv');
const express = require('express');
const openapi = require('express-openapi');
const yaml = require('js-yaml');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '../..');
const settingsPath = path.join(repoRoot, 'src/model/service/api/encode/settings.ts');
const adminAccessPath = path.join(repoRoot, 'src/model/service/api/adminAccess.ts');
const encodeIdPath = path.join(repoRoot, 'src/model/service/api/encode/{encodeId}.ts');
const document = yaml.load(fs.readFileSync(path.join(repoRoot, 'api.yml'), 'utf8'));
const recorded = { dropThreshold: null, dropCheckEnabled: true };
const counts = { get: 0, update: 0, cancel: [] };
let activeProfile = null;
let failUpdate = null;
let failGet = null;
const settingsModel = {
    getSettings: async () => {
        counts.get += 1;
        if (failGet !== null) throw failGet;
        return { ...recorded };
    },
    updateSettings: async option => {
        counts.update += 1;
        if (failUpdate !== null) throw failUpdate;
        return { ...recorded, dropThreshold: option.dropThreshold };
    },
};
const encodeModel = { cancel: async id => counts.cancel.push(id) };
const container = {
    get: key => {
        if (key === 'IAutoEncodeSettingsModel') return settingsModel;
        if (key === 'IEncodeApiModel') return encodeModel;
        if (key === 'ITvUserDB') return { findId: async id => ({ id, isAdmin: id === 7 }) };
        if (key === 'IViewerProfileDB') return { findByTvUserId: async () => activeProfile };
        if (key === 'IViewerProfileApiModel') return { authenticate: async () => false };
        throw new Error(`Unexpected model ${key}`);
    },
};

function loadTypeScript(sourcePath, mocks) {
    const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const loaded = new Module(sourcePath, module);
    loaded.filename = sourcePath;
    loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === sourcePath && Object.hasOwn(mocks, request)) return mocks[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loaded._compile(compiled, sourcePath);
    } finally {
        Module._load = originalLoad;
    }
    return loaded.exports;
}

const adminAccess = loadTypeScript(adminAccessPath, {
    '../../ModelContainer': { default: container },
    './activeUser': { getActiveUserId: req => Number(req.header('x-epgstation-user-id') ?? 0) },
});
class AutoEncodeSettingsValidationError extends Error {}
const settingsOperations = loadTypeScript(settingsPath, {
    '../../../../../api': {},
    '../../../encode/AutoEncodeSettingsModel': { AutoEncodeSettingsValidationError },
    '../../../encode/IAutoEncodeSettingsModel': {},
    '../../../ModelContainer': { default: container },
    '../../ApiOperation': {},
    '../../api': {
        responseJSON: (res, code, body) => res.status(code).json(body),
        responseError: (res, reason) => res.status(reason.code).json(reason),
        responseServerError: (_res, _error) => _res.status(500).json({ code: 500, message: 'Internal Server Error' }),
    },
    '../adminAccess': adminAccess,
});
const encodeIdOperations = loadTypeScript(encodeIdPath, {
    '../../ApiOperation': {},
    '../../../api/encode/IEncodeApiModel': {},
    '../../../ModelContainer': { default: container },
    '../../api': {
        responseJSON: (res, code, body) => res.status(code).json(body),
        responseServerError: (_res, _error) => _res.status(500).json({ code: 500, message: 'Internal Server Error' }),
    },
});

const app = express();
app.use(express.json());
document.servers = [{ url: '/api' }];
const apiReady = openapi.initialize({
    apiDoc: document,
    app,
    docsPath: '/docs',
    paths: [
        { path: '/encode/settings', module: settingsOperations },
        { path: '/encode/{encodeId}', module: encodeIdOperations },
    ],
    errorMiddleware: (err, _req, res, _next) => res.status(400).json(err),
});
let server;
let baseUrl;

before(async () => {
    await apiReady;
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => new Promise(resolve => server.close(resolve)));

test('API returns settings and updates them after the admin guard', async () => {
    const getResponse = await fetch(`${baseUrl}/encode/settings`);
    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), { dropThreshold: null, dropCheckEnabled: true });

    const putResponse = await fetch(`${baseUrl}/encode/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-epgstation-user-id': '7' },
        body: JSON.stringify({ dropThreshold: 23 }),
    });
    assert.equal(putResponse.status, 200);
    assert.deepEqual(await putResponse.json(), { dropThreshold: 23, dropCheckEnabled: true });
    assert.equal(counts.update, 1);
});

test('non-admin and locked admin requests cannot invoke updateSettings', async () => {
    const before = counts.update;
    const response = await fetch(`${baseUrl}/encode/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-epgstation-user-id': '0' },
        body: JSON.stringify({ dropThreshold: 10 }),
    });
    assert.equal(response.status, 403);
    assert.equal(counts.update, before);

    activeProfile = { id: 9, pinSalt: 'salt', pinHash: 'hash' };
    const lockedResponse = await fetch(`${baseUrl}/encode/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-epgstation-user-id': '7' },
        body: JSON.stringify({ dropThreshold: 11 }),
    });
    assert.equal(lockedResponse.status, 403);
    assert.equal(counts.update, before);
    activeProfile = null;
});

test('validation and storage failures map to 400 and 500', async () => {
    failUpdate = new AutoEncodeSettingsValidationError('drop数は1以上の整数で指定してください');
    const invalidResponse = await fetch(`${baseUrl}/encode/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-epgstation-user-id': '7' },
        body: JSON.stringify({ dropThreshold: 0 }),
    });
    assert.equal(invalidResponse.status, 400);
    const rejectedByModel = await fetch(`${baseUrl}/encode/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-epgstation-user-id': '7' },
        body: JSON.stringify({ dropThreshold: 12 }),
    });
    assert.equal(rejectedByModel.status, 400);
    failUpdate = new Error('storage unavailable');
    const storageResponse = await fetch(`${baseUrl}/encode/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-epgstation-user-id': '7' },
        body: JSON.stringify({ dropThreshold: 12 }),
    });
    assert.equal(storageResponse.status, 500);
    failUpdate = null;

    failGet = new Error('storage unavailable');
    const getFailure = await fetch(`${baseUrl}/encode/settings`);
    assert.equal(getFailure.status, 500);
    failGet = null;
});

test('OpenAPI schema accepts null and positive safe integers and rejects invalid values', () => {
    const ajv = new Ajv({ allErrors: true, jsonPointers: true, nullable: true });
    const validate = ajv.compile(document.components.schemas.UpdateAutoEncodeSettingsOption);
    for (const value of [{ dropThreshold: null }, { dropThreshold: 1 }, { dropThreshold: Number.MAX_SAFE_INTEGER }]) {
        assert.equal(validate(value), true, JSON.stringify(value));
    }
    for (const value of [
        {},
        { dropThreshold: 0 },
        { dropThreshold: -1 },
        { dropThreshold: 1.5 },
        { dropThreshold: '1' },
        { dropThreshold: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
        assert.equal(validate(value), false, JSON.stringify(value));
    }
    const validateSettings = ajv.compile(document.components.schemas.AutoEncodeSettings);
    assert.equal(validateSettings({ dropThreshold: null, dropCheckEnabled: false }), true);
    assert.equal(validateSettings({ dropThreshold: 1, dropCheckEnabled: true }), true);
    assert.equal(validateSettings({ dropThreshold: '1', dropCheckEnabled: true }), false);
});

test('static settings route and dynamic encode id route remain distinct', async () => {
    const response = await fetch(`${baseUrl}/encode/42`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { code: 200 });
    assert.deepEqual(counts.cancel, [42]);
});
