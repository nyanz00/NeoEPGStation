const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const axios = require('axios');
const ts = require('typescript');

const previousTypeScriptLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
            esModuleInterop: true,
        },
        fileName: filename,
    }).outputText;
    module._compile(output, filename);
};

const SyoboiCalendarClient = require('../../src/model/api/annict/SyoboiCalendarClient.ts').default;
if (previousTypeScriptLoader === undefined) delete require.extensions['.ts'];
else require.extensions['.ts'] = previousTypeScriptLoader;

const programXml = (items, code = '200') =>
    `<ProgLookupResponse><ProgItems>${items}</ProgItems><Result><Code>${code}</Code><Message></Message></Result></ProgLookupResponse>`;
const channelXml = items =>
    `<ChLookupResponse><Result><Code>200</Code></Result><ChItems>${items}</ChItems></ChLookupResponse>`;
const programRow = (overrides = {}) => {
    const values = {
        PID: '721695',
        TID: '8070',
        ChID: '128',
        StTime: '2026-10-05 01:05:00',
        Count: '1',
        Flag: '2',
        ...overrides,
    };
    return `<ProgItem id="${values.PID}">${Object.entries(values)
        .map(([key, value]) => `<${key}>${value}</${key}>`)
        .join('')}</ProgItem>`;
};
const stationRows = [
    '<ChItem id="128"><ChID>128</ChID><ChName>BS11イレブン</ChName><ChGID>2</ChGID></ChItem>',
    '<ChItem id="1"><ChID>1</ChID><ChName>TOKYO MX &amp; 2</ChName><ChGID>1</ChGID></ChItem>',
    '<ChItem id="2"><ChID>2</ChID><ChName>BS11</ChName><ChGID>2</ChGID></ChItem>',
    '<ChItem id="3"><ChID>3</ChID><ChName>AT-X</ChName><ChGID>6</ChGID></ChItem>',
    '<ChItem id="4"><ChID>4</ChID><ChName>Web Stream</ChName><ChGID>0</ChGID></ChItem>',
    '<ChItem id="5"><ChID>5</ChID><ChName>Invalid Group</ChName><ChGID>4</ChGID></ChItem>',
].join('');

function bypassRateWait(client) {
    client.waitForSlot = async () => {};
}

test('program lookup sends multiple TIDs and maps JST times, broadcast flags, and TV channels', async t => {
    const originalGet = axios.get;
    t.after(() => {
        axios.get = originalGet;
    });
    const client = new SyoboiCalendarClient();
    bypassRateWait(client);
    const requests = [];
    axios.get = async (url, config) => {
        requests.push({ url, config });
        if (config.params.Command === 'ProgLookup') {
            return {
                data: programXml(
                    [
                        programRow(),
                        programRow({ PID: '11', TID: '20', ChID: '2', Flag: '0', StTime: '2026-10-06 00:15:00' }),
                        programRow({ PID: '12', TID: '20', ChID: '3', Flag: '9', StTime: '2026-10-05 23:05:00' }),
                        programRow({ PID: '13', ChID: '4' }),
                        programRow({ PID: 'bad' }),
                        programRow({ PID: '14', StTime: '20260230_120000' }),
                    ].join(''),
                ),
            };
        }
        return { data: channelXml(stationRows) };
    };

    const programs = await client.getPrograms([20, 21], '20261001_000000', '20261031_235959');
    assert.deepEqual(programs, [
        {
            pid: 721695,
            tid: 8070,
            channelId: 128,
            channelName: 'BS11イレブン',
            channelGroup: 2,
            count: 1,
            startedAt: '2026-10-05T01:05:00+09:00',
            rebroadcast: false,
        },
        {
            pid: 11,
            tid: 20,
            channelId: 2,
            channelName: 'BS11',
            channelGroup: 2,
            count: 1,
            startedAt: '2026-10-06T00:15:00+09:00',
            rebroadcast: false,
        },
        {
            pid: 12,
            tid: 20,
            channelId: 3,
            channelName: 'AT-X',
            channelGroup: 6,
            count: 1,
            startedAt: '2026-10-05T23:05:00+09:00',
            rebroadcast: true,
        },
    ]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://cal.syoboi.jp/db.php');
    assert.deepEqual(requests[0].config.params, {
        Command: 'ProgLookup',
        TID: '20,21',
        StTime: '20261001_000000-20261031_235959',
        Fields: 'PID,TID,ChID,StTime,Count,Flag',
        Count: '1',
    });
    assert.equal(requests[0].config.timeout, 20_000);
    assert.equal(requests[0].config.headers['User-Agent'], 'NeoEPGStation (+https://github.com/nyanz00/NeoEPGStation)');

    requests.length = 0;
    await client.getPrograms([20], '20261001_000000', '20261031_235959', false);
    assert.equal(requests[0].config.params.Count, undefined);
});

test('program lookup distinguishes malformed and failed XML, and rejects the 5000 row cap', async t => {
    const originalGet = axios.get;
    t.after(() => {
        axios.get = originalGet;
    });
    const client = new SyoboiCalendarClient();
    bypassRateWait(client);
    let xml = '<html>not XML data</html>';
    axios.get = async () => ({ data: xml });
    await assert.rejects(client.getPrograms([1], '20261001_000000', '20261002_000000'), /ルートがProgLookupResponse/);

    xml = programXml('', '500');
    await assert.rejects(client.getPrograms([1], '20261001_000000', '20261002_000000'), /Result Code=500/);

    xml = programXml(Array.from({ length: 5000 }, (_, index) => programRow({ PID: String(index + 1) })).join(''));
    await assert.rejects(client.getPrograms([1], '20261001_000000', '20261002_000000'), /5000件上限/);

    xml = '<ProgLookupResponse><ProgItems/><Result><Code>200</Code></Result></ProgLookupResponse>';
    axios.get = async (_url, config) => ({
        data: config.params.Command === 'ProgLookup' ? xml : channelXml(stationRows),
    });
    assert.deepEqual(await client.getPrograms([1], '20261001_000000', '20261002_000000'), []);
});

test('simultaneous program lookups share one complete channel lookup', async t => {
    const originalGet = axios.get;
    t.after(() => {
        axios.get = originalGet;
    });
    const client = new SyoboiCalendarClient();
    bypassRateWait(client);
    let channelRequests = 0;
    axios.get = async (_url, config) => {
        if (config.params.Command === 'ChLookup') {
            channelRequests++;
            await new Promise(resolve => setTimeout(resolve, 5));
            return { data: channelXml(stationRows) };
        }
        return { data: programXml(programRow({ TID: config.params.TID })) };
    };
    const start = '20261001_000000';
    const end = '20261002_000000';
    const results = await Promise.all([client.getPrograms([20], start, end), client.getPrograms([21], start, end)]);
    assert.equal(channelRequests, 1);
    assert.equal(results[0][0].tid, 20);
    assert.equal(results[1][0].tid, 21);
});

test('title search and RSS use the shared request options and validate title response shape', async t => {
    const originalGet = axios.get;
    t.after(() => {
        axios.get = originalGet;
    });
    const client = new SyoboiCalendarClient();
    bypassRateWait(client);
    const requests = [];
    axios.get = async (url, config) => {
        requests.push({ url, config });
        if (url.endsWith('/json.php')) {
            return {
                data: {
                    Titles: {
                        42: { TID: '42', Title: '作品', FirstYear: '2026', FirstMonth: '10' },
                        invalid: { TID: 'invalid', Title: 'skip' },
                        43: { TID: '43', Title: '年不明' },
                    },
                },
            };
        }
        return { data: { items: [] } };
    };
    assert.deepEqual(await client.searchTitle('作品'), [
        { tid: 42, title: '作品', firstYear: 2026, firstMonth: 10 },
        { tid: 43, title: '年不明' },
    ]);
    assert.deepEqual(await client.getRss({ start: '20261001_000000', days: 14, alt: 'json' }), { items: [] });
    assert.deepEqual(requests[0].config.params, { Req: 'TitleSearch', Search: '作品', Limit: '20' });
    assert.deepEqual(requests[1].config.params, { start: '20261001_000000', days: '14', alt: 'json' });
    for (const request of requests) {
        assert.equal(request.config.timeout, 20_000);
        assert.equal(request.config.headers['User-Agent'], 'NeoEPGStation (+https://github.com/nyanz00/NeoEPGStation)');
    }
    axios.get = async () => ({ data: { titles: [] } });
    await assert.rejects(client.searchTitle('bad'), /タイトル検索応答の形式/);
});

test('the request queue serializes HTTP work and recovers after a failed request', async t => {
    const originalGet = axios.get;
    t.after(() => {
        axios.get = originalGet;
    });
    const client = new SyoboiCalendarClient();
    bypassRateWait(client);
    let releaseFirst;
    const firstRequest = new Promise((_, reject) => {
        releaseFirst = () => reject(new Error('network failure'));
    });
    let started = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    axios.get = async url => {
        started++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
            if (url.endsWith('/json.php')) return await firstRequest;
            return { data: { ok: true } };
        } finally {
            inFlight--;
        }
    };

    const failed = client.searchTitle('test');
    const following = client.getRss({ start: '20261001_000000', days: 1, alt: 'json' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started, 1);
    releaseFirst();
    await assert.rejects(failed, /network failure/);
    assert.deepEqual(await following, { ok: true });
    assert.equal(started, 2);
    assert.equal(maxInFlight, 1);
});

test('the slot scheduler enforces the minimum 1100ms start interval', async t => {
    const client = new SyoboiCalendarClient();
    const originalNow = Date.now;
    const originalSetTimeout = global.setTimeout;
    t.after(() => {
        Date.now = originalNow;
        global.setTimeout = originalSetTimeout;
    });
    client.lastRequestStartedAt = 100;
    Date.now = () => 200;
    let waited;
    global.setTimeout = (callback, milliseconds) => {
        waited = milliseconds;
        callback();
        return 0;
    };
    await client.waitForSlot();
    assert.equal(waited, 1000);
});
