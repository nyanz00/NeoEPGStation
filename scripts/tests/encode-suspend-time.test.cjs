const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/util/EncodeSuspendTime.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loadedModule._compile(compiled, sourcePath);

const { getNextEncodeResumeTime, isEncodeSuspended, validateEncodeSuspendTimes } = loadedModule.exports;

test('validates strict 24-hour HH:mm settings and rejects equal endpoints', () => {
    validateEncodeSuspendTimes([
        { start: '00:00', end: '23:59' },
        { start: '23:30', end: '01:15' },
    ]);

    for (const invalid of ['24:00', '9:00', '12:60', '1:15', '', null]) {
        assert.throws(() => validateEncodeSuspendTimes([{ start: invalid, end: '01:00' }]));
    }
    assert.throws(() => validateEncodeSuspendTimes([{ start: '00:00', end: '00:00' }]), /must differ/);
    assert.throws(() => validateEncodeSuspendTimes({ start: '01:00', end: '02:00' }));
});

test('checks inclusive starts and exclusive ends for daytime and overnight periods', () => {
    const periods = [
        { start: '09:00', end: '10:00' },
        { start: '23:30', end: '01:15' },
    ];
    assert.equal(isEncodeSuspended(periods, new Date(2026, 0, 2, 9, 0)), true);
    assert.equal(isEncodeSuspended(periods, new Date(2026, 0, 2, 9, 59, 59)), true);
    assert.equal(isEncodeSuspended(periods, new Date(2026, 0, 2, 10, 0)), false);
    assert.equal(isEncodeSuspended(periods, new Date(2026, 0, 2, 23, 30)), true);
    assert.equal(isEncodeSuspended(periods, new Date(2026, 0, 3, 1, 14)), true);
    assert.equal(isEncodeSuspended(periods, new Date(2026, 0, 3, 1, 15)), false);
});

test('returns the first gap after overlapping active periods', () => {
    const periods = [
        { start: '22:00', end: '23:00' },
        { start: '22:30', end: '00:30' },
    ];
    const now = new Date(2026, 0, 2, 22, 15);
    assert.equal(getNextEncodeResumeTime(periods, now).getTime(), new Date(2026, 0, 3, 0, 30).getTime());
    assert.equal(getNextEncodeResumeTime(periods, new Date(2026, 0, 2, 21, 59)), null);
});

test('advances by local calendar day across a daylight-saving transition', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
        const now = new Date(2026, 2, 7, 23, 30);
        const resume = getNextEncodeResumeTime([{ start: '23:00', end: '01:00' }], now);
        assert.equal(resume.getFullYear(), 2026);
        assert.equal(resume.getMonth(), 2);
        assert.equal(resume.getDate(), 8);
        assert.equal(resume.getHours(), 1);
        assert.equal(resume.getMinutes(), 0);
        assert.equal((resume.getTime() - now.getTime()) / 60_000, 90);
    } finally {
        if (typeof previousTimezone === 'undefined') delete process.env.TZ;
        else process.env.TZ = previousTimezone;
    }
});
