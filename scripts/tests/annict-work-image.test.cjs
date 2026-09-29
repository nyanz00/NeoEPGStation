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
const animeRules = require('../../client/src/core/animeRules.ts');
if (previousTypeScriptLoader === undefined) delete require.extensions['.ts'];
else require.extensions['.ts'] = previousTypeScriptLoader;

test('undated registered TV stations remain selectable without web streaming dates', async () => {
    const model = Object.create(AnnictApiModel.prototype);
    const row = (id, name, state = '公開') =>
        `<tr>${[id, id, name, '-', '-', '-', '-', state].map(value => `<td>${value}</td>`).join('')}</tr>`;
    const html = `<table><th>チャンネルID</th><th>放送開始日時</th>${row(19, 'TOKYO MX')}${row(128, 'BS11イレブン')}${row(165, 'ニコニコチャンネル')}${row(999, 'MBS', '非公開')}</table>`;
    const channels = model.parseRegisteredWorkChannels(html, [
        { id: 11, name: 'BS11', channelType: 'BS' },
        { id: 12, name: 'MBS', channelType: 'GR' },
    ]);
    assert.deepEqual(channels, [{ id: 11, name: 'BS11', channelType: 'BS' }]);
    assert.throws(() => model.parseRegisteredWorkChannels('<html>unavailable</html>', []), /形式/);
    const work = {
        title: 'Test',
        releasedOn: '2026-10-05',
        unscheduledChannels: channels,
        programs: [{ startedAt: '2026-10-07T16:05:00Z', channelName: 'ニコニコチャンネル', localChannels: [] }],
    };
    const option = animeRules.buildBulkAnimeSearchOption(work, false, [], Date.parse('2026-09-29'));
    assert.deepEqual(option.channelIds, [11]);
    assert.equal(option.times[0].week, 0x7f);
    assert.equal(option.searchPeriods[0].startAt, new Date('2026-10-05T00:00:00').getTime());
    assert.equal(animeRules.firstBroadcastSearchPeriods({}), undefined);
});

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

test('work detail does not expose an earliest streaming slot as its rule start date', async () => {
    const model = Object.create(AnnictApiModel.prototype);
    model.root = '/unused';
    model.readCache = async () => null;
    model.requestWithSavedToken = async () => ({ searchWorks: { nodes: [{ annictId: 17600 }] } });
    model.channelApiModel = { getChannels: async () => [] };
    model.mapWork = () => ({ annictId: 17600, title: 'Test', firstProgramStartedAt: '2026-10-07T16:05:00Z' });
    model.getPrograms = async () => ({ programs: [{ startedAt: '2026-10-07T16:05:00Z', localChannels: [] }] });
    model.getRestWorkDetail = async () => ({ releasedOn: '2026-10-05' });
    model.getAnnictPageMetadata = async () => ({});
    model.getAnnictInfoPageReleasedOn = async () => '2026-10-05';
    model.getRestCasts = model.getRestStaffs = async () => [];
    model.getRegisteredWorkChannels = async () => ({ channels: [{ id: 11, name: 'BS11', channelType: 'BS' }] });
    model.resolveWorkImageUrl = async () => 'https://example.com/image.jpg';
    model.writeJson = async () => {};
    model.addSyoboiProgramFallback = async (_id, value) => value;
    const detail = await model.getWork(17600, true);
    assert.equal(detail.firstProgramStartedAt, undefined);
    assert.equal(detail.unscheduledChannels[0].id, 11);
    assert.equal(
        animeRules.buildAnimeSearchOption(detail).searchPeriods[0].startAt,
        new Date('2026-10-05T00:00:00').getTime(),
    );
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
        assert.deepEqual(variables, { ids: [1] });
        return {
            searchWorks: {
                nodes: [
                    {
                        annictId: 1,
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

test('schedule batches retain progress after rate limiting and resume only missing works', async () => {
    const model = Object.create(AnnictApiModel.prototype);
    const works = Array.from({ length: 127 }, (_, index) => ({ annictId: index + 1, title: `Work ${index}` }));
    let saved = works;
    let calls = 0;
    let fail = true;
    model.requestWithSavedToken = async (_query, { ids }, strict) => {
        calls++;
        assert.equal(strict, true);
        assert.ok(ids.length <= 50);
        assert.match(_query, /searchWorks\(annictIds: \$ids, first: 50\)/);
        if (fail && calls === 2) throw new Error('HTTP 429');
        return {
            searchWorks: {
                nodes: ids.map(annictId => ({
                    annictId,
                    programs: {
                        nodes: [{ channel: { name: 'MBS' }, startedAt: '2026-10-05T00:00:00+09:00' }],
                        pageInfo: { hasNextPage: false },
                    },
                })),
            },
        };
    };
    await assert.rejects(
        model.enrichWorkBroadcastStarts(works, async value => {
            saved = value;
        }),
        /429/,
    );
    assert.equal(saved.filter(work => work.broadcastStarts !== undefined).length, 50);
    fail = false;
    calls = 0;
    const result = await model.enrichWorkBroadcastStarts(saved);
    assert.equal(calls, 2);
    assert.equal(result.filter(work => work.broadcastStarts !== undefined).length, 127);
    await model.enrichWorkBroadcastStarts(result);
    assert.equal(calls, 2);
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
