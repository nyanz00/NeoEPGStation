const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

const previousTypeScriptLoader = require.extensions['.ts'];
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
const AnnictApiModel = require('../../src/model/api/annict/AnnictApiModel.ts').default;
if (previousTypeScriptLoader === undefined) delete require.extensions['.ts'];
else require.extensions['.ts'] = previousTypeScriptLoader;

const season = '2026-autumn';
const startedAt = '2026-10-05T01:05:00+09:00';
const work = (annictId, extra = {}) => ({ annictId, title: `Work ${annictId}`, ...extra });
const program = (channelName, extra = {}) => ({ startedAt, channel: { name: channelName }, ...extra });

function temporaryRoot(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neoepg-annict-broadcast-cache-'));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('neoepg-annict-broadcast-cache-'));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return directory;
}

function createModel(root = '/unused') {
    const model = Object.create(AnnictApiModel.prototype);
    model.root = root;
    model.log = { system: { warn() {} } };
    model.channelApiModel = {
        getChannels: async () => [
            { id: 1, name: 'BS11' },
            { id: 2, name: 'AT-X' },
        ],
    };
    model.workListRefreshRequests = new Map();
    model.workListRefreshFailures = new Map();
    model.workListEnrichmentRequests = new Map();
    model.workListEnrichmentFailures = new Map();
    model.workListCacheWriteQueues = new Map();
    return model;
}

function receivedProgramPage(nodes, { hasNextPage = false, endCursor } = {}) {
    return { nodes, pageInfo: { hasNextPage, ...(endCursor === undefined ? {} : { endCursor }) } };
}

test('initial and cached work-list refreshes request 100 and 50 works per page', async t => {
    const root = temporaryRoot(t);
    const model = createModel(root);
    const basicFile = path.join(root, 'cache', `works-basic-v3-${season}.json`);
    const enrichedFile = path.join(root, 'cache', `works-v13-${season}.json`);
    const requests = [];
    let id = 0;
    model.mapWork = node => node;
    model.requestWorkListData = async (query, variables) => {
        requests.push({ query, variables });
        id += 1;
        return { searchWorks: { nodes: [{ annictId: id, title: `Work ${id}` }], pageInfo: { hasNextPage: false } } };
    };
    model.startWorkListEnrichment = () => false;

    await model.refreshWorkList(season, basicFile, enrichedFile);
    await model.refreshWorkList(season, basicFile, enrichedFile);

    assert.deepEqual(
        requests.map(request => request.variables.first),
        [100, 50],
    );
    assert.ok(requests.every(request => request.query.includes('first: $first')));
});

test('initial missing broadcast starts use batches of 25 works', async () => {
    const model = createModel();
    const requests = [];
    model.getBroadcastTargets = async () => channelName => channelName === 'BS11';
    model.needsBroadcastCheck = () => true;
    model.requestWorkListData = async (query, variables) => {
        requests.push({ query, variables });
        return {
            searchWorks: {
                nodes: variables.ids.map(annictId => ({
                    annictId,
                    programs: receivedProgramPage([program('BS11')]),
                })),
            },
        };
    };

    await model.enrichWorkBroadcastStarts(
        Array.from({ length: 26 }, (_, index) => work(index + 1)),
        undefined,
        true,
    );

    assert.deepEqual(
        requests.map(request => request.variables.ids.length),
        [25, 1],
    );
    assert.deepEqual(
        requests.map(request => request.variables.first),
        [25, 1],
    );
});

test('cached missing starts use batches of 12 and acquired starts are rechecked in batches of 5', async () => {
    const model = createModel();
    const requests = [];
    model.getBroadcastTargets = async () => channelName => channelName === 'BS11';
    model.needsBroadcastCheck = () => true;
    model.requestWorkListData = async (_query, variables) => {
        requests.push(variables);
        return {
            searchWorks: {
                nodes: variables.ids.map(annictId => ({
                    annictId,
                    programs: receivedProgramPage([program('BS11')]),
                })),
            },
        };
    };
    const missing = Array.from({ length: 13 }, (_, index) => work(index + 1));
    const acquired = Array.from({ length: 6 }, (_, index) =>
        work(index + 101, { broadcastStarts: [{ channelName: 'BS11', startedAt }], broadcastStartsCheckedAt: 0 }),
    );

    await model.enrichWorkBroadcastStarts([...missing, ...acquired]);

    assert.deepEqual(
        requests.map(request => request.ids.length),
        [12, 1, 5, 1],
    );
    assert.deepEqual(
        requests.map(request => request.first),
        [12, 1, 5, 1],
    );
});

test('broadcast scans use ordered pages of 10 and stop at the first receivable channel', async () => {
    const model = createModel();
    const requests = [];
    model.requestWorkListData = async (query, variables) => {
        requests.push({ query, variables });
        return {
            searchWorks: {
                nodes: [
                    {
                        programs: receivedProgramPage([program('BS11')], {
                            hasNextPage: true,
                            endCursor: 'page-3',
                        }),
                    },
                ],
            },
        };
    };
    const firstPage = receivedProgramPage(
        Array.from({ length: 10 }, () => program('WEB')),
        {
            hasNextPage: true,
            endCursor: 'page-2',
        },
    );

    const result = await model.getWorkBroadcastStarts(
        { annictId: 1, programs: firstPage },
        channelName => channelName === 'BS11',
    );

    assert.equal(requests.length, 1);
    for (const { query, variables } of requests) {
        assert.match(query, /programs\(first: 10, after: \$after, orderBy: \{ field: STARTED_AT, direction: ASC \}\)/);
        assert.equal(variables.after, 'page-2');
    }
    assert.deepEqual(
        result.starts.map(value => value.channelName),
        ['WEB', 'BS11'],
    );
    assert.equal(result.complete, false);
    assert.equal(result.after, 'page-3');
});

test('broadcast scans continue without a receivable channel and reject missing or repeated cursors', async () => {
    const model = createModel();
    let requests = 0;
    model.requestWorkListData = async () => {
        requests += 1;
        return {
            searchWorks: {
                nodes: [
                    {
                        programs: receivedProgramPage([program('WEB')], {
                            hasNextPage: true,
                            endCursor: 'same-cursor',
                        }),
                    },
                ],
            },
        };
    };
    await assert.rejects(
        model.getWorkBroadcastStarts(
            { annictId: 1, programs: receivedProgramPage([program('WEB')], { hasNextPage: true }) },
            () => false,
        ),
        /カーソル/,
    );
    assert.equal(requests, 0);

    await assert.rejects(
        model.getWorkBroadcastStarts(
            {
                annictId: 1,
                programs: receivedProgramPage([program('WEB')], { hasNextPage: true, endCursor: 'same-cursor' }),
            },
            () => false,
        ),
        /カーソル/,
    );
    assert.equal(requests, 1);
});

test('an interrupted broadcast scan saves its cursor and resumes from that page', async () => {
    const model = createModel();
    const requests = [];
    let fail = true;
    model.getBroadcastTargets = async () => channelName => channelName === 'BS11';
    model.needsBroadcastCheck = () => true;
    model.requestWorkListData = async (query, variables) => {
        requests.push({ query, variables });
        if (query.includes('WorkBroadcastStartsBatch')) {
            return {
                searchWorks: {
                    nodes: [
                        {
                            annictId: 1,
                            programs: receivedProgramPage([program('WEB')], {
                                hasNextPage: true,
                                endCursor: 'page-2',
                            }),
                        },
                    ],
                },
            };
        }
        if (fail) throw new Error('HTTP 429');
        return {
            searchWorks: {
                nodes: [
                    {
                        programs: receivedProgramPage([program('BS11')], {
                            hasNextPage: true,
                            endCursor: 'page-3',
                        }),
                    },
                ],
            },
        };
    };
    const saved = [];
    const oldStarts = [{ channelName: 'BS11', startedAt: '2026-09-01T01:05:00+09:00' }];
    await assert.rejects(
        model.enrichWorkBroadcastStarts(
            [work(1, { broadcastStarts: oldStarts, broadcastStartsCheckedAt: 0 })],
            value => saved.push(value),
            false,
        ),
        /429/,
    );
    const partial = saved.at(-1)[0];
    assert.equal(partial.broadcastScan.after, 'page-2');
    assert.deepEqual(partial.broadcastScan.cursors, ['page-2']);
    assert.deepEqual(partial.broadcastStarts, oldStarts);
    assert.deepEqual(
        partial.broadcastScan.starts.map(value => value.channelName),
        ['WEB'],
    );

    fail = false;
    const resumed = await model.enrichWorkBroadcastStarts([partial]);

    assert.deepEqual(
        requests.filter(value => !value.query.includes('WorkBroadcastStartsBatch')).map(value => value.variables.after),
        ['page-2', 'page-2'],
    );
    assert.deepEqual(
        resumed[0].broadcastStarts.map(value => value.channelName),
        ['WEB', 'BS11'],
    );
});

test('paid-channel exclusion and no-target cache recheck intervals follow current settings', async () => {
    const model = createModel();
    model.matchLocalChannels = (name, channels) => channels.filter(channel => channel.name === name);
    const includePaid = await model.getBroadcastTargets(false);
    const excludePaid = await model.getBroadcastTargets(true);
    assert.equal(includePaid('AT-X'), true);
    assert.equal(excludePaid('AT-X'), false);
    assert.equal(excludePaid('BS11'), true);

    const originalNow = Date.now;
    const now = Date.parse('2026-10-12T00:00:00Z');
    Date.now = () => now;
    try {
        const targets = await model.getBroadcastTargets(false);
        const noTarget = work(1, {
            broadcastStarts: [{ channelName: 'WEB', startedAt: '2026-10-20T00:00:00Z' }],
            broadcastStartsComplete: true,
            broadcastStartsCheckedAt: now - 23 * 60 * 60 * 1000,
        });
        assert.equal(model.needsBroadcastCheck(noTarget, targets), false);
        assert.equal(
            model.needsBroadcastCheck({ ...noTarget, broadcastStartsCheckedAt: now - 25 * 60 * 60 * 1000 }, targets),
            true,
        );
        assert.equal(model.needsBroadcastCheck({ ...noTarget, broadcastStartsComplete: false }, targets), true);
        const past = work(2, {
            broadcastStarts: [{ channelName: 'BS11', startedAt: '2026-10-01T00:00:00Z' }],
            broadcastStartsCheckedAt: now - 6 * 24 * 60 * 60 * 1000,
        });
        assert.equal(model.needsBroadcastCheck(past, targets), false);
        assert.equal(
            model.needsBroadcastCheck({ ...past, broadcastStartsCheckedAt: now - 7 * 24 * 60 * 60 * 1000 }, targets),
            true,
        );
        const future = { ...past, broadcastStarts: [{ channelName: 'BS11', startedAt: '2026-11-01T00:00:00Z' }] };
        assert.equal(model.needsBroadcastCheck(future, targets), true);
    } finally {
        Date.now = originalNow;
    }
});

test('cache merge retains acquired metadata and selects the latest checked broadcast state', () => {
    const model = createModel();
    const oldStarts = [{ channelName: 'BS11', startedAt: '2026-10-01T01:05:00+09:00' }];
    const newerStarts = [{ channelName: 'BS11', startedAt: '2026-10-10T01:05:00+09:00' }];
    const enriched = {
        cachedAt: 500,
        generation: 'enriched-generation',
        value: [
            work(1, {
                imageUrl: 'https://image.example/old.jpg',
                releasedOn: '2026-10-01',
                titleKana: 'ふるい',
                broadcastStarts: oldStarts,
                broadcastStartsCheckedAt: 100,
                broadcastStartsComplete: true,
            }),
        ],
    };
    const basic = {
        cachedAt: 400,
        generation: 'basic-generation',
        value: [
            work(1, {
                broadcastStarts: newerStarts,
                broadcastStartsCheckedAt: 300,
                broadcastStartsComplete: true,
            }),
        ],
    };

    const [merged] = model.mergeCachedWorkList([work(1, { title: 'Refreshed title' })], [basic, enriched]);

    assert.equal(merged.title, 'Refreshed title');
    assert.equal(merged.imageUrl, 'https://image.example/old.jpg');
    assert.equal(merged.releasedOn, '2026-10-01');
    assert.equal(merged.titleKana, 'ふるい');
    assert.deepEqual(merged.broadcastStarts, newerStarts);
    assert.equal(merged.broadcastStartsCheckedAt, 300);
});

test('each completed work is saved before a later work fails', async () => {
    const model = createModel();
    model.getBroadcastTargets = async () => channelName => channelName === 'BS11';
    model.needsBroadcastCheck = () => true;
    model.requestWorkListData = async (_query, variables) => ({
        searchWorks: {
            nodes: [
                {
                    annictId: variables.ids[0],
                    programs: receivedProgramPage([program('BS11')]),
                },
            ],
        },
    });
    const saved = [];

    await assert.rejects(
        model.enrichWorkBroadcastStarts([work(1), work(2)], value => saved.push(value)),
        /放送開始日時/,
    );

    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0][0].broadcastStarts, [{ channelName: 'BS11', startedAt }]);
    assert.equal(saved[0][0].broadcastStartsComplete, true);
    assert.equal(saved[0][1].broadcastStarts, undefined);
});

test('an older enrichment generation cannot overwrite a refreshed cache', async t => {
    const root = temporaryRoot(t);
    const model = createModel(root);
    const basicFile = path.join(root, 'cache', `works-basic-v3-${season}.json`);
    const enrichedFile = path.join(root, 'cache', `works-v13-${season}.json`);
    const current = {
        cachedAt: 200,
        generation: 'current-generation',
        value: [work(1, { title: 'Current', broadcastStarts: [{ channelName: 'BS11', startedAt }] })],
    };
    await model.writeJson(basicFile, current);
    model.enrichWorkBroadcastStarts = async (_works, saveProgress) => {
        await saveProgress([work(1, { title: 'Old generation', broadcastStarts: [] })]);
        return [work(1, { title: 'Old generation', broadcastStarts: [] })];
    };
    model.fillMissingWorkImages = async works => works;
    model.enrichWorkReleaseDates = async works => works;

    assert.equal(
        model.startWorkListEnrichment(
            season,
            [work(1, { title: 'Old generation' })],
            100,
            'old-generation',
            basicFile,
            enrichedFile,
        ),
        true,
    );
    await model.workListEnrichmentRequests.get(`${season}:old-generation`);

    assert.deepEqual(await model.readCache(basicFile), current);
    assert.equal(await model.readCache(enrichedFile), null);
});

test('work-list requests are spaced, and a 429 rate-limits later requests', async () => {
    const originalNow = Date.now;
    const originalSetTimeout = global.setTimeout;
    let now = Date.parse('2026-10-12T00:00:00Z');
    Date.now = () => now;
    global.setTimeout = (callback, delay) => {
        assert.equal(delay, 1_000);
        now += delay;
        queueMicrotask(callback);
        return 1;
    };
    try {
        const model = createModel();
        model.workListRequestQueue = Promise.resolve();
        model.workListLastRequestAt = now;
        model.workListRateLimitedUntil = 0;
        const requestTimes = [];
        let shouldRateLimit = false;
        model.requestWithSavedToken = async (_query, _variables, strict) => {
            assert.equal(strict, true);
            requestTimes.push(Date.now());
            if (shouldRateLimit) {
                const error = new Error('HTTP 429');
                error.response = { status: 429, headers: { 'retry-after': '60' } };
                throw error;
            }
            return {};
        };

        await model.requestWorkListData('query One', {});
        await model.requestWorkListData('query Two', {});
        assert.deepEqual(requestTimes, [Date.parse('2026-10-12T00:00:01Z'), Date.parse('2026-10-12T00:00:02Z')]);

        shouldRateLimit = true;
        await assert.rejects(model.requestWorkListData('query Three', {}), /429/);
        assert.ok(model.workListRateLimitedUntil >= now + 5 * 60_000);
        await assert.rejects(model.requestWorkListData('query Four', {}), /アクセス制限解除/);
        assert.equal(requestTimes.length, 3);
    } finally {
        Date.now = originalNow;
        global.setTimeout = originalSetTimeout;
    }
});

test('cache reads show completed progress while retaining the other previously acquired dates', async t => {
    const root = temporaryRoot(t);
    const model = createModel(root);
    const now = Date.now();
    const oldStarts = [{ channelName: 'BS11', startedAt }];
    const updatedStarts = [{ channelName: 'BS11', startedAt: '2026-10-06T01:05:00+09:00' }];
    const old = {
        cachedAt: now,
        generation: 'same',
        value: [
            work(1, { title: 'Old title', broadcastStarts: oldStarts, broadcastStartsCheckedAt: now - 1000 }),
            work(2, { broadcastStarts: oldStarts, broadcastStartsCheckedAt: now }),
        ],
    };
    const progress = {
        cachedAt: now,
        generation: 'same',
        value: [
            work(1, { title: 'New title', broadcastStarts: updatedStarts, broadcastStartsCheckedAt: now }),
            old.value[1],
        ],
    };
    await model.writeJson(path.join(root, 'cache', `works-v13-${season}.json`), old);
    await model.writeJson(path.join(root, 'cache', `works-basic-v3-${season}.json`), progress);
    model.getBroadcastTargets = async () => name => name === 'BS11';
    const result = await model.getCachedWorks(season, false);
    assert.equal(result.works[0].title, 'New title');
    assert.deepEqual(result.works[0].broadcastStarts, updatedStarts);
    assert.deepEqual(result.works[1].broadcastStarts, oldStarts);
    assert.equal(result.enrichmentPending, false);
});

test(
    'list refresh keeps old dates and does not wait for an entire older background scan',
    { timeout: 1000 },
    async t => {
        const root = temporaryRoot(t);
        const model = createModel(root);
        const basicFile = path.join(root, 'cache', `works-basic-v3-${season}.json`);
        const enrichedFile = path.join(root, 'cache', `works-v13-${season}.json`);
        const starts = [{ channelName: 'BS11', startedAt }];
        await model.writeJson(basicFile, {
            cachedAt: Date.now(),
            generation: 'old',
            value: [work(1, { broadcastStarts: starts })],
        });
        model.workListEnrichmentRequests.set(`${season}:old`, new Promise(() => {}));
        model.fetchBasicWorkList = async (_season, pageSize) => {
            assert.equal(pageSize, 50);
            return [work(1, { title: 'Updated' }), work(2)];
        };
        model.startWorkListEnrichment = () => false;
        const result = await model.refreshWorkList(season, basicFile, enrichedFile);
        assert.equal(result.works[0].title, 'Updated');
        assert.deepEqual(result.works[0].broadcastStarts, starts);
        assert.equal(result.works[1].broadcastStarts, undefined);
    },
);

test('finishing a saved scan clears its resume cursor when old and new caches are merged', () => {
    const model = createModel();
    const old = {
        cachedAt: 10,
        value: [
            work(1, {
                broadcastScan: { starts: [], after: 'next', cursors: ['next'], checkedAt: 11 },
            }),
        ],
    };
    const complete = {
        cachedAt: 10,
        value: [
            work(1, {
                broadcastStarts: [{ channelName: 'BS11', startedAt }],
                broadcastStartsCheckedAt: 12,
                broadcastStartsComplete: true,
            }),
        ],
    };
    const [result] = model.mergeCachedWorkList([work(1)], [old, complete]);
    assert.equal(result.broadcastScan, undefined);
    assert.equal(result.broadcastStartsComplete, true);
});

test('cache generation replacement waits for a pending progress commit and retains its dates', async t => {
    const root = temporaryRoot(t);
    const model = createModel(root);
    const basicFile = path.join(root, 'cache', `works-basic-v3-${season}.json`);
    const enrichedFile = path.join(root, 'cache', `works-v13-${season}.json`);
    await model.writeJson(basicFile, { cachedAt: 1, generation: 'old', value: [work(1)] });
    let release;
    const pending = model.withWorkListCacheLock(basicFile, async () => {
        await new Promise(resolve => {
            release = resolve;
        });
        await model.writeJson(basicFile, {
            cachedAt: 1,
            generation: 'old',
            value: [
                work(1, {
                    broadcastStarts: [{ channelName: 'BS11', startedAt }],
                    broadcastStartsCheckedAt: 2,
                }),
            ],
        });
    });
    await Promise.resolve();
    model.fetchBasicWorkList = async () => [work(1)];
    model.startWorkListEnrichment = () => false;
    const refresh = model.refreshWorkList(season, basicFile, enrichedFile);
    release();
    await pending;
    const result = await refresh;
    assert.deepEqual(result.works[0].broadcastStarts, [{ channelName: 'BS11', startedAt }]);
    assert.equal(model.workListCacheWriteQueues.size, 0);
});
