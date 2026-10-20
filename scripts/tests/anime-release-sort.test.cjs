const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

const previousTypeScriptLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
        fileName: filename,
    }).outputText;
    module._compile(output, filename);
};
const { workStartDateValue } = require('../../client/src/core/animeReleaseSort.ts');
if (previousTypeScriptLoader === undefined) delete require.extensions['.ts'];
else require.extensions['.ts'] = previousTypeScriptLoader;

test('works sourced from their release date sort by a strict release date', () => {
    assert.equal(
        workStartDateValue(
            { releasedOn: '2026-10-05', firstReceivableProgramStartedAt: '2026-10-03T00:00:00+09:00' },
            'work',
        ),
        Date.parse('2026-10-05'),
    );
    assert.equal(workStartDateValue({ releasedOn: '2026-2-05' }, 'work'), Number.POSITIVE_INFINITY);
    assert.equal(workStartDateValue({ releasedOn: '2026-02-30' }, 'work'), Number.POSITIVE_INFINITY);
    assert.equal(workStartDateValue({ releasedOn: '2026-02-29' }, 'work'), Number.POSITIVE_INFINITY);
    assert.equal(workStartDateValue({ releasedOn: '2024-02-29' }, 'work'), Date.parse('2024-02-29'));
    assert.equal(
        workStartDateValue({ firstReceivableProgramStartedAt: '2026-10-03T00:00:00+09:00' }, 'work'),
        Number.POSITIVE_INFINITY,
    );
});

test('works without a work release-date source keep the first receivable-program date', () => {
    assert.equal(
        workStartDateValue(
            { releasedOn: '2026-10-05', firstReceivableProgramStartedAt: '2026-10-03T00:00:00+09:00' },
            'receivable-program',
        ),
        Date.parse('2026-10-02T15:00:00.000Z'),
    );
    assert.equal(workStartDateValue({}, undefined), Number.POSITIVE_INFINITY);
});
