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

test('work list start dates use receivable stations and respect paid-channel exclusion', async () => {
    const model = Object.create(AnnictApiModel.prototype);
    const date = day => `2026-10-${String(day).padStart(2, '0')}T00:00:00+09:00`;
    model.getCachedWorks = async () => ({
        works: [
            {
                annictId: 1,
                title: 'Test',
                firstProgramStartedAt: date(1),
                broadcastStarts: [
                    { channelName: 'WEB', startedAt: date(1) },
                    { channelName: 'TOKYO MX', startedAt: date(2) },
                    { channelName: 'AT-X', startedAt: date(3) },
                    { channelName: 'MBS', startedAt: date(5) },
                ],
            },
            { annictId: 2, title: 'No schedule', releasedOn: '2026-10-01' },
        ],
    });
    let channels = [
        { id: 1, name: 'MBS', type: 1 },
        { id: 2, name: 'AT-X', type: 1 },
    ];
    model.channelApiModel = { getChannels: async () => channels };
    const all = await model.getWorks('2026-autumn', false);
    assert.equal(all.works[0].firstReceivableProgramStartedAt, date(3));
    assert.equal(all.works[0].firstProgramStartedAt, date(1));
    assert.equal(all.works[0].broadcastStarts, undefined);
    assert.equal(all.works[1].firstReceivableProgramStartedAt, undefined);
    assert.equal(
        (await model.getWorks('2026-autumn', false, false, true)).works[0].firstReceivableProgramStartedAt,
        date(5),
    );
    channels = [{ id: 3, name: 'TOKYO MX', type: 1 }];
    assert.equal((await model.getWorks('2026-autumn', false)).works[0].firstReceivableProgramStartedAt, date(2));
});

test('station start dates include later pages and keep the earliest date for each station', async () => {
    const model = Object.create(AnnictApiModel.prototype);
    const node = (name, startedAt) => ({ channel: { name }, startedAt });
    model.requestWithSavedToken = async (_query, variables) => {
        assert.deepEqual(variables, { ids: [1], after: 'next' });
        return {
            searchWorks: {
                nodes: [
                    {
                        programs: {
                            nodes: [node('MBS', '2026-10-05T00:00:00+09:00'), node('WEB', '2026-10-08T00:00:00+09:00')],
                            pageInfo: { hasNextPage: false },
                        },
                    },
                ],
            },
        };
    };
    const work = {
        annictId: 1,
        programs: {
            nodes: [node('WEB', '2026-10-01T00:00:00+09:00'), node('invalid', 'unknown')],
            pageInfo: { hasNextPage: true, endCursor: 'next' },
        },
    };
    assert.deepEqual(await model.getWorkBroadcastStarts(work), [
        { channelName: 'WEB', startedAt: '2026-10-01T00:00:00+09:00' },
        { channelName: 'MBS', startedAt: '2026-10-05T00:00:00+09:00' },
    ]);
    model.requestWithSavedToken = async () => ({ searchWorks: { nodes: [work] } });
    await assert.rejects(model.getWorkBroadcastStarts(work), /カーソル/);
});

test('background schedule enrichment fetches the first page and preserves work metadata', async () => {
    const model = Object.create(AnnictApiModel.prototype);
    model.requestWithSavedToken = async (_query, variables) => {
        assert.deepEqual(variables, { ids: [1], after: undefined });
        return {
            searchWorks: {
                nodes: [
                    {
                        programs: {
                            nodes: [{ channel: { name: 'MBS' }, startedAt: '2026-10-05T00:00:00+09:00' }],
                            pageInfo: { hasNextPage: false },
                        },
                    },
                ],
            },
        };
    };
    const work = { annictId: 1, title: 'Test', imageUrl: 'https://example.com/image.jpg' };
    const result = await model.enrichWorkBroadcastStarts([work]);
    assert.deepEqual(result, [
        { ...work, broadcastStarts: [{ channelName: 'MBS', startedAt: '2026-10-05T00:00:00+09:00' }] },
    ]);
});

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
