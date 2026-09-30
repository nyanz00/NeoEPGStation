const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
            esModuleInterop: true,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
        },
        fileName: filename,
    }).outputText;
    module._compile(output, filename);
};
const Supplement = require('../../src/model/api/annict/SyoboiBroadcastSupplement.ts').default;
const AnnictApiModel = require('../../src/model/api/annict/AnnictApiModel.ts').default;
const animeRules = require('../../client/src/core/animeRules.ts');
if (previousLoader === undefined) delete require.extensions['.ts'];
else require.extensions['.ts'] = previousLoader;

const season = '2026-autumn';
const originalNow = Date.now;
test.before(() => {
    Date.now = () => Date.parse('2026-09-30T03:00:00Z');
});
test.after(() => {
    Date.now = originalNow;
});
const work = (id, extra = {}) => ({ annictId: id, syobocalTid: id, title: `Work ${id}`, media: 'TV', ...extra });
const program = (tid, extra = {}) => ({
    pid: tid,
    tid,
    channelId: 128,
    channelGroup: 2,
    channelName: 'BS11イレブン',
    count: 1,
    startedAt: '2026-10-05T01:05:00+09:00',
    rebroadcast: false,
    ...extra,
});
function root(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neoepg-syoboi-supplement-'));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('neoepg-syoboi-supplement-'));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return directory;
}

test('missing works are batched first, persisted, and reused by another cache reader', async t => {
    const directory = root(t);
    const calls = [];
    const client = {
        getPrograms: async (ids, start, end, firstOnly) => {
            calls.push(ids);
            assert.equal(start, '20260917_000000');
            assert.equal(end, '20270115_000000');
            assert.equal(firstOnly, undefined);
            return ids.map(id => program(id));
        },
    };
    const supplement = new Supplement(directory, client, () => {});
    const works = Array.from({ length: 105 }, (_, index) => work(index + 1, { missingBroadcasts: index >= 100 }));
    const initial = await supplement.readAndQueue(works, season);
    assert.ok(initial.every(state => state.pending));
    await supplement.waitForIdle();
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].slice(0, 5), [101, 102, 103, 104, 105]);
    assert.ok(calls.every(ids => ids.length <= 50));
    const next = await new Supplement(directory, client, () => {}).readAndQueue(works, season, true);
    assert.ok(next.every(state => !state.pending && state.programs.length === 1));
    assert.equal(calls.length, 3);
});

test('a queued detail moves ahead of the remaining list and shares its in-flight request', async t => {
    const calls = [];
    let release;
    let started;
    const began = new Promise(resolve => {
        started = resolve;
    });
    const gate = new Promise(resolve => {
        release = resolve;
    });
    const supplement = new Supplement(
        root(t),
        {
            getPrograms: async ids => {
                calls.push(ids);
                if (calls.length === 1) {
                    started();
                    await gate;
                }
                return ids.map(id => program(id));
            },
        },
        () => {},
    );
    await supplement.readAndQueue(
        Array.from({ length: 102 }, (_, index) => work(index + 1)),
        season,
    );
    await began;
    const detail = await supplement.readAndQueue([work(102)], season, true);
    assert.equal(detail[0].pending, true);
    await supplement.readAndQueue([work(1)], season, true);
    release();
    await supplement.waitForIdle();
    assert.equal(calls[1][0], 102);
    assert.equal(calls.flat().filter(id => id === 1).length, 1);
});

test('WEB-only works are skipped; confirmed television stations and ambiguous title misses are cached', async t => {
    let searches = 0;
    let requests = 0;
    const supplement = new Supplement(
        root(t),
        {
            searchTitle: async () => {
                searches++;
                return [
                    { tid: 20, title: 'Duplicate' },
                    { tid: 21, title: 'Duplicate' },
                ];
            },
            getPrograms: async ids => {
                requests++;
                return ids.map(id => program(id));
            },
        },
        () => {},
    );
    const works = [
        work(1, { media: 'WEB' }),
        work(2, { media: 'WEB', hasTelevisionChannels: true }),
        work(3, { title: 'Duplicate', syobocalTid: undefined }),
    ];
    const initial = await supplement.readAndQueue(works, season);
    assert.equal(initial[0].pending, false);
    await supplement.waitForIdle();
    const states = await supplement.readAndQueue(works, season);
    assert.equal(states[2].tid, undefined);
    assert.equal(states[2].error, undefined);
    assert.equal(states[2].pending, false);
    assert.equal(searches, 1);
    assert.equal(requests, 1);
});

test('no first episode uses only a bounded nearby lookup, and empty results are cached', async t => {
    const calls = [];
    const supplement = new Supplement(
        root(t),
        {
            getPrograms: async (ids, start, end, firstOnly) => {
                calls.push({ ids, start, end, firstOnly });
                return [];
            },
        },
        () => {},
    );
    await supplement.readAndQueue([work(1)], season);
    await supplement.waitForIdle();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].firstOnly, false);
    const parse = value =>
        Date.parse(value.replace(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6+09:00'));
    assert.ok(parse(calls[1].end) - parse(calls[1].start) <= 32 * 86400000);
    const [state] = await supplement.readAndQueue([work(1)], season);
    assert.equal(state.pending, false);
    assert.deepEqual(state.programs, []);
    assert.equal(calls.length, 2);
});

test('a failed refresh retains prior slots, exposes failure, and backs off without losing rerun seeds', async t => {
    let fail = false;
    let calls = 0;
    const supplement = new Supplement(
        root(t),
        {
            getPrograms: async ids => {
                calls++;
                if (fail) throw new Error('HTTP 429');
                return ids.map(id => program(id));
            },
        },
        () => {},
    );
    await supplement.readAndQueue([work(1)], season);
    await supplement.waitForIdle();
    await supplement.seed(1, season, 1, [
        program(1, { pid: 99, rebroadcast: true, startedAt: '2026-12-01T01:05:00+09:00' }),
    ]);
    fail = true;
    await supplement.readAndQueue([work(1)], season, true, true);
    await supplement.waitForIdle();
    const [state] = await supplement.readAndQueue([work(1)], season);
    assert.equal(state.pending, false);
    assert.ok(state.error);
    assert.equal(state.programs.length, 2);
    assert.equal(calls, 2);
});

test('an already aired first episode keeps its start date and also loads upcoming slots', async t => {
    const calls = [];
    const supplement = new Supplement(
        root(t),
        {
            getPrograms: async (ids, start, end, firstOnly) => {
                calls.push({ ids, start, end, firstOnly });
                return firstOnly === false
                    ? [program(1, { pid: 2, count: 5, startedAt: '2026-10-05T01:05:00+09:00' })]
                    : [program(1, { startedAt: '2026-09-05T01:05:00+09:00' })];
            },
        },
        () => {},
    );
    await supplement.readAndQueue([work(1)], season);
    await supplement.waitForIdle();
    const [state] = await supplement.readAndQueue([work(1)], season);
    assert.equal(calls.length, 2);
    assert.deepEqual(
        state.programs.map(slot => slot.count),
        [1, 5],
    );
    assert.equal(state.programs[0].startedAt, '2026-09-05T01:05:00+09:00');
});

test('a failed nearby lookup retains the first-slot progress and reports incomplete refresh', async t => {
    const supplement = new Supplement(
        root(t),
        {
            getPrograms: async (_ids, _start, _end, firstOnly) => {
                if (firstOnly === false) throw new Error('timeout');
                return [program(1, { startedAt: '2026-09-05T01:05:00+09:00' })];
            },
        },
        () => {},
    );
    await supplement.readAndQueue([work(1)], season);
    await supplement.waitForIdle();
    const [state] = await supplement.readAndQueue([work(1)], season);
    assert.equal(state.pending, false);
    assert.ok(state.error);
    assert.equal(state.programs.length, 1);
});

test('Annict dates win conflicts while new television stations update details and both rule entry points', async () => {
    const model = Object.create(AnnictApiModel.prototype);
    model.root = '/unused';
    const channels = [
        { id: 11, name: 'BS11', channelType: 'BS' },
        { id: 12, name: 'MBS', channelType: 'GR' },
    ];
    model.channelApiModel = { getChannels: async () => channels };
    model.readCache = async () => null;
    model.readBroadcastSupplements = async () => [
        {
            programs: [
                program(1),
                program(1, { pid: 2, channelName: 'MBS', startedAt: '2026-10-04T01:05:00+09:00' }),
                program(1, { pid: 3, rebroadcast: true, channelName: 'MBS', startedAt: '2026-10-03T01:05:00+09:00' }),
            ],
            pending: false,
        },
    ];
    const detail = await model.addSyoboiProgramFallback(1, {
        annictId: 1,
        title: 'Test',
        media: 'TV',
        seasonYear: 2026,
        seasonName: 'AUTUMN',
        programsError: 'Annict partial failure',
        programs: [
            {
                annictId: 1,
                channelName: 'MBS',
                startedAt: '2026-10-06T01:05:00+09:00',
                firstBroadcast: true,
                rebroadcast: false,
                localChannels: [channels[1]],
            },
            {
                annictId: 2,
                channelName: 'WEB',
                startedAt: '2026-10-01T01:05:00+09:00',
                rebroadcast: false,
                localChannels: [],
            },
        ],
        unscheduledChannels: [channels[0]],
    });
    assert.equal(detail.programs.length, 3);
    assert.equal(detail.programs.find(value => value.channelName === 'MBS').startedAt, '2026-10-06T01:05:00+09:00');
    assert.equal(detail.firstProgramStartedAt, '2026-10-05T01:05:00+09:00');
    assert.deepEqual(detail.unscheduledChannels, []);
    assert.equal(detail.programsError, 'Annict partial failure');
    assert.equal(detail.programs.find(value => value.source === 'syoboi').rebroadcast, false);
    const single = animeRules.buildAnimeSearchOption(detail, [11]);
    const bulk = animeRules.buildBulkAnimeSearchOption(detail, false, [], Date.parse('2026-09-30'));
    assert.equal(single.searchPeriods[0].startAt, new Date('2026-10-05T00:00:00').getTime());
    assert.deepEqual(single.searchPeriods, bulk.searchPeriods);
    assert.deepEqual(bulk.channelIds.sort(), [11, 12]);
});

test('list sorting uses the same supplement and applies current receivable/paid filters', async () => {
    const model = Object.create(AnnictApiModel.prototype);
    model.getCachedWorks = async () => ({
        works: [{ ...work(1), broadcastStarts: [{ channelName: 'WEB', startedAt: '2026-10-01T01:05:00+09:00' }] }],
    });
    model.channelApiModel = {
        getChannels: async () => [
            { id: 11, name: 'BS11' },
            { id: 12, name: 'AT-X' },
        ],
    };
    model.readBroadcastSupplements = async () => [
        {
            programs: [program(1), program(1, { pid: 2, channelName: 'AT-X', startedAt: '2026-10-02T01:05:00+09:00' })],
            pending: true,
            error: 'partial failure',
        },
    ];
    const all = await model.getWorks(season, false);
    const free = await model.getWorks(season, false, false, true);
    assert.equal(all.works[0].firstReceivableProgramStartedAt, '2026-10-02T01:05:00+09:00');
    assert.equal(free.works[0].firstReceivableProgramStartedAt, '2026-10-05T01:05:00+09:00');
    assert.equal(all.broadcastSupplementPending, true);
    assert.equal(all.broadcastSupplementError, 'partial failure');
});

test('Annict enrichment is allowed to establish priorities before unknown list works are queued', async t => {
    let calls = 0;
    const supplement = new Supplement(
        root(t),
        {
            getPrograms: async ids => {
                calls++;
                return ids.map(id => program(id));
            },
        },
        () => {},
    );
    const [deferred] = await supplement.readAndQueue([work(1, { defer: true })], season);
    assert.equal(deferred.pending, false);
    await supplement.waitForIdle();
    assert.equal(calls, 0);
    await supplement.readAndQueue([work(1, { missingBroadcasts: true })], season);
    await supplement.waitForIdle();
    assert.equal(calls, 1);
});

test('past supplementary starts keep their station selectable when no upcoming slot is known', async () => {
    const model = Object.create(AnnictApiModel.prototype);
    model.root = '/unused';
    const channel = { id: 11, name: 'BS11', channelType: 'BS' };
    model.channelApiModel = { getChannels: async () => [channel] };
    model.readCache = async () => null;
    model.readBroadcastSupplements = async () => [
        { programs: [program(1, { startedAt: '2026-09-29T01:05:00+09:00' })], pending: false },
    ];
    const detail = await model.addSyoboiProgramFallback(1, { annictId: 1, title: 'Test', media: 'TV', programs: [] });
    assert.deepEqual(
        detail.unscheduledChannels.map(item => item.id),
        [11],
    );
    const option = animeRules.buildBulkAnimeSearchOption(detail, false, [], Date.now());
    assert.deepEqual(option.channelIds, [11]);
    assert.equal(option.times[0].week, 0x7f);
});

test('supplemented slots reuse Annict station identity and replace only older Syoboi rows', () => {
    const model = Object.create(AnnictApiModel.prototype);
    const channel = { id: 11, name: 'BS11', channelType: 'BS' };
    const annict = {
        annictId: 100,
        startedAt: '2026-10-05T01:05:00+09:00',
        channelAnnictId: 128,
        channelName: 'BS11',
        episodeNumber: 1,
        firstBroadcast: true,
        rebroadcast: false,
        localChannels: [channel],
    };
    const old = {
        ...annict,
        annictId: -2,
        episodeNumber: 2,
        firstBroadcast: false,
        source: 'syoboi',
        startedAt: '2026-10-12T01:00:00+09:00',
    };
    const slots = model.mergeBroadcastPrograms(
        [annict, old],
        [program(1, { pid: 2, count: 2, startedAt: '2026-10-12T01:05:00+09:00' })],
        [channel],
        false,
    );
    assert.equal(slots.length, 2);
    assert.equal(slots[1].channelAnnictId, 128);
    assert.equal(slots[1].startedAt, '2026-10-12T01:05:00+09:00');
    assert.equal(slots[0].annictId, 100);
});
