'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
        fileName: filename,
    }).outputText;
    module._compile(output, filename);
};

const factoryPath = path.resolve(__dirname, '../..', 'src/model/MirakurunClientModel.ts');
const packageInfo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../..', 'package.json'), 'utf8'));
const createdAccessModels = [];

class FakeTunerServerAccessModel {
    constructor(target, userAgent, timeout) {
        this.target = target;
        this.userAgent = userAgent;
        this.timeout = timeout;
        createdAccessModels.push(this);
    }
}

function loadMirakurunClientModel() {
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === factoryPath) {
            if (request === 'inversify') return { inject: () => () => {}, injectable: () => target => target };
            if (request === './tuner/TunerServerAccessModel') {
                return { __esModule: true, default: FakeTunerServerAccessModel };
            }
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require(factoryPath).default;
    } finally {
        Module._load = originalLoad;
    }
}

const MirakurunClientModel = loadMirakurunClientModel();

function createFactory(config) {
    return new MirakurunClientModel({ getConfig: () => config });
}

test('passes configured tuner path, user agent, and request timeout to shared access model', () => {
    createdAccessModels.length = 0;
    const config = { mirakurunPath: 'http://tuner.local:40772/nested/api', tunerRequestTimeout: 4321 };
    const factory = createFactory(config);
    const client = factory.getClient();

    assert.equal(createdAccessModels.length, 1);
    assert.equal(client, createdAccessModels[0]);
    assert.equal(client.target, config.mirakurunPath);
    assert.equal(client.userAgent, `NeoEPGStation/${packageInfo.version}`);
    assert.equal(client.timeout, config.tunerRequestTimeout);
    assert.equal(factory.getClient(), client);
});

test('uses a 30 second timeout when tunerRequestTimeout is omitted', () => {
    createdAccessModels.length = 0;
    const factory = createFactory({ mirakurunPath: 'http://tuner.local:40772' });

    assert.equal(factory.getClient(), createdAccessModels[0]);
    assert.equal(createdAccessModels[0].target, 'http://tuner.local:40772');
    assert.equal(createdAccessModels[0].userAgent, `NeoEPGStation/${packageInfo.version}`);
    assert.equal(createdAccessModels[0].timeout, 30000);
});
