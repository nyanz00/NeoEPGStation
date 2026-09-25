const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const axios = require('axios');
const ts = require('typescript');
require('reflect-metadata');

const previousTypeScriptLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            esModuleInterop: true,
        },
        fileName: filename,
    }).outputText;
    module._compile(output, filename);
};

const AnnictApiModel = require('../../src/model/api/annict/AnnictApiModel.ts').default;
if (previousTypeScriptLoader === undefined) delete require.extensions['.ts'];
else require.extensions['.ts'] = previousTypeScriptLoader;

test('work image fallback reads the Annict-hosted image and can refresh stale metadata', async t => {
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neoepg-annict-image-'));
    const originalGet = axios.get;
    t.after(() => {
        axios.get = originalGet;
        fs.rmSync(cacheRoot, { recursive: true, force: true });
    });

    const model = Object.create(AnnictApiModel.prototype);
    model.root = cacheRoot;
    model.log = { system: { warn() {} } };
    let imageUrl = 'https://image.annict.com/first.jpg';
    let requests = 0;
    axios.get = async url => {
        assert.equal(url, 'https://annict.com/works/11196');
        requests += 1;
        return { data: `<meta property="og:image" content="${imageUrl}">` };
    };

    assert.deepEqual(await model.getWorkImage(11196, false), { imageUrl });
    imageUrl = 'https://image.annict.com/updated.jpg';
    assert.deepEqual(await model.getWorkImage(11196, false), { imageUrl: 'https://image.annict.com/first.jpg' });
    assert.equal(requests, 1);
    assert.deepEqual(await model.getWorkImage(11196, true), { imageUrl });
    assert.equal(requests, 2);
    await assert.rejects(model.getWorkImage(0, false), /annictIdが不正です/);
});
