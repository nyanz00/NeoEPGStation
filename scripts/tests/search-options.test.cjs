const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScriptModule(relativePath) {
    const filename = path.join(__dirname, '..', '..', relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
        fileName: filename,
    }).outputText;
    const loaded = { exports: {} };
    Function(
        'exports',
        'module',
        'require',
        '__filename',
        '__dirname',
        output,
    )(loaded.exports, loaded, require, filename, path.dirname(filename));
    return loaded.exports;
}

const options = loadTypeScriptModule('client/src/core/search/options.ts');
const timeRule = loadTypeScriptModule('client/src/core/search/timeRule.ts');
const sessionValues = new Map();
global.sessionStorage = {
    getItem: key => sessionValues.get(key) ?? null,
    setItem: (key, value) => sessionValues.set(key, String(value)),
    removeItem: key => sessionValues.delete(key),
};
const searchStorage = loadTypeScriptModule('client/src/core/storage/search.ts');

test('keyword searches restore the Vue default targets when every target is disabled', () => {
    const form = options.createDefaultSearchForm();
    form.keyword = 'include';
    form.ignoreKeyword = 'exclude';
    form.keywordFields = { caseSensitive: false, regexp: false, name: false, description: false, extended: false };
    form.ignoreFields = { caseSensitive: false, regexp: false, name: false, description: false, extended: false };
    const result = options.toSearchOption(form);
    assert.equal(result.name, true);
    assert.equal(result.description, true);
    assert.equal(result.extended, false);
    assert.equal(result.ignoreName, true);
    assert.equal(result.ignoreDescription, true);
    assert.equal(result.ignoreExtended, false);
});

test('search periods preserve minute precision in JST', () => {
    const form = options.createDefaultSearchForm();
    form.startDate = '2026-09-22';
    form.startTime = '18:30';
    form.endDate = '2026-09-23';
    form.endTime = '03:15';
    const option = options.toSearchOption(form);
    assert.deepEqual(option.searchPeriods, [
        {
            startAt: Date.UTC(2026, 8, 22, 9, 30),
            endAt: Date.UTC(2026, 8, 22, 18, 15),
        },
    ]);
    const restored = options.fromSearchOption(option);
    assert.equal(restored.startDate, form.startDate);
    assert.equal(restored.startTime, form.startTime);
    assert.equal(restored.endDate, form.endDate);
    assert.equal(restored.endTime, form.endTime);
});

test('search period times start empty and default to day boundaries only when dates are selected', () => {
    const form = options.createDefaultSearchForm();
    assert.equal(form.startTime, '');
    assert.equal(form.endTime, '');
    assert.equal(options.toSearchOption(form).searchPeriods, undefined);

    form.startDate = '2026-09-22';
    form.endDate = '2026-09-23';
    assert.equal(options.searchPeriodError(form), null);
    assert.deepEqual(options.toSearchOption(form).searchPeriods, [
        {
            startAt: Date.UTC(2026, 8, 21, 15),
            endAt: Date.UTC(2026, 8, 23, 14, 59),
        },
    ]);
    const restored = options.fromSearchOption({});
    assert.equal(restored.startTime, '');
    assert.equal(restored.endTime, '');
});

test('an invalid or reversed search period is rejected before searching', () => {
    const form = options.createDefaultSearchForm();
    form.startDate = '2026-02-30';
    assert.equal(options.searchPeriodError(form), '開始日時を正しく入力してください');
    form.startDate = '2026-09-22';
    form.startTime = '99:00';
    assert.equal(options.searchPeriodError(form), '開始日時を正しく入力してください');
    form.startDate = '2026-09-23';
    form.startTime = '03:00';
    form.endDate = '2026-09-22';
    form.endTime = '18:00';
    assert.equal(options.searchPeriodError(form), '開始日時は終了日時以前にしてください');
});

test('time rules reject equal endpoints and retain overnight ranges', () => {
    assert.throws(() => timeRule.timeRuleRangeSeconds('01:00', '01:00'), /開始時刻と終了時刻を変えてください/);
    assert.throws(() => timeRule.timeRuleRangeSeconds('1:00', '02:00'), /時刻を正しく入力してください/);
    assert.throws(() => timeRule.timeRuleRangeSeconds('24:00', '02:00'), /時刻を正しく入力してください/);
    assert.deepEqual(timeRule.timeRuleRangeSeconds('23:30', '00:30'), { start: 84_600, range: 3_600 });
});

test('search history is restored only for the URL that created it', () => {
    const form = options.createDefaultSearchForm();
    form.keyword = 'first search';
    searchStorage.saveSearchHistory('history-key', {
        routeSearch: '?keyword=first',
        form,
        submittedOption: options.toSearchOption(form),
    });
    assert.equal(searchStorage.loadSearchHistory('history-key', '?keyword=other'), null);
    assert.equal(searchStorage.loadSearchHistory('history-key', '?keyword=first').form.keyword, 'first search');
});
