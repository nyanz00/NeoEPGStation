const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScript(relativePath, dependencies = {}) {
    const absolutePath = path.resolve(__dirname, relativePath);
    const compiled = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const loaded = new Module(absolutePath, module);
    loaded.filename = absolutePath;
    loaded.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath && request in dependencies) return dependencies[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loaded._compile(compiled, absolutePath);
    } finally {
        Module._load = originalLoad;
    }
    return loaded.exports;
}

const dateTime = loadTypeScript('../../client/src/core/dateTimeInput.ts');

test('date and time inputs validate and round-trip picker values without timezone conversion', () => {
    assert.equal(dateTime.parseDateText('２０２４／０２／２９'), '2024-02-29');
    assert.equal(dateTime.parseDateText('2023/02/29'), null);
    assert.equal(dateTime.parseDateText('0000/01/01'), null);
    assert.equal(dateTime.parseDateText('2024-02-29'), '2024-02-29');
    assert.deepEqual(dateTime.dateTimeValueParts('2024-02-29T23:59'), { date: '2024-02-29', time: '23:59' });
    assert.equal(dateTime.dateTimeValueParts('2024-02-29T24:00'), null);
    assert.equal(dateTime.formatDateTimeText('2024-02-29T23:59'), '2024/02/29 23:59');
    assert.equal(dateTime.parseDateTimeText('2024/02/29 23:59'), '2024-02-29T23:59');

    const date = dateTime.datePickerValueToDate('2024-02-29');
    assert.ok(date);
    assert.equal(dateTime.datePickerDateToValue(date), '2024-02-29');
    const time = dateTime.timePickerValueToDate('23:59');
    assert.ok(time);
    assert.equal(dateTime.timePickerDateToValue(time), '23:59');
    const localDateTime = dateTime.dateTimePickerValueToDate('2024-02-29T23:59');
    assert.ok(localDateTime);
    assert.equal(dateTime.dateTimePickerDateToValue(localDateTime), '2024-02-29T23:59');
});

class MockDayjs {
    constructor(value) {
        this.value = new Date(value);
    }
    isValid() {
        return Number.isFinite(this.value.getTime());
    }
    toDate() {
        return new Date(this.value);
    }
    hour(value) {
        if (value === undefined) return this.value.getHours();
        const next = new Date(this.value);
        next.setHours(value);
        return new MockDayjs(next);
    }
    minute(value) {
        if (value === undefined) return this.value.getMinutes();
        const next = new Date(this.value);
        next.setMinutes(value);
        return new MockDayjs(next);
    }
    format(pattern) {
        const pad = value => String(value).padStart(2, '0');
        if (pattern === 'HH:mm') return `${pad(this.value.getHours())}:${pad(this.value.getMinutes())}`;
        if (pattern === 'dd') return 'Mo';
        return '';
    }
}

function createHookHarness() {
    const states = [];
    const effects = [];
    let cursor = 0;
    let dirty = false;
    const sameDeps = (left, right) =>
        left !== undefined &&
        left.length === right.length &&
        left.every((value, index) => Object.is(value, right[index]));
    const hooks = {
        useState(initial) {
            const index = cursor++;
            if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
            return [
                states[index],
                value => {
                    const next = typeof value === 'function' ? value(states[index]) : value;
                    if (!Object.is(states[index], next)) {
                        states[index] = next;
                        dirty = true;
                    }
                },
            ];
        },
        useEffect(effect, dependencies) {
            const index = cursor++;
            if (!sameDeps(effects[index]?.dependencies, dependencies))
                effects[index] = { effect, dependencies, pending: true };
        },
    };
    return {
        hooks,
        render(component, props) {
            let tree;
            for (let pass = 0; pass < 20; pass++) {
                dirty = false;
                cursor = 0;
                tree = component(props);
                for (const effect of effects) {
                    if (effect?.pending) {
                        effect.pending = false;
                        effect.effect();
                    }
                }
                if (!dirty) return tree;
            }
            assert.fail('React hook harness did not settle after effects');
        },
    };
}

function descendants(node, predicate, result = []) {
    if (node === null || node === undefined) return result;
    if (Array.isArray(node)) {
        for (const child of node) descendants(child, predicate, result);
        return result;
    }
    if (typeof node !== 'object') return result;
    if (predicate(node)) result.push(node);
    descendants(node.props?.children, predicate, result);
    return result;
}

function loadDialog() {
    const harness = createHookHarness();
    const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
    const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
    const muiNames = [
        'Box',
        'Button',
        'Dialog',
        'DialogActions',
        'DialogContent',
        'DialogTitle',
        'Stack',
        'Typography',
    ];
    const material = Object.fromEntries(muiNames.map(name => [name, name]));
    const dayjs = value => new MockDayjs(value);
    dayjs.extend = () => {};
    dayjs.updateLocale = () => {};
    dayjs.locale = () => 'ja';
    const dialog = loadTypeScript('../../client/src/components/DateTimePickerDialog.tsx', {
        '@mui/icons-material/CalendarMonthOutlined': { __esModule: true, default: 'CalendarMonthOutlined' },
        '@mui/icons-material/AccessTimeOutlined': { __esModule: true, default: 'AccessTimeOutlined' },
        '@mui/material': material,
        'react/jsx-runtime': jsxRuntime,
        react: harness.hooks,
        dayjs: { __esModule: true, default: dayjs },
        'dayjs/locale/ja': {},
        'dayjs/plugin/updateLocale': { __esModule: true, default: () => {} },
        '@mui/x-date-pickers/DateCalendar': { DateCalendar: 'DateCalendar' },
        '@mui/x-date-pickers/LocalizationProvider': { LocalizationProvider: 'LocalizationProvider' },
        '@mui/x-date-pickers/TimeClock': { TimeClock: 'TimeClock' },
        '@mui/x-date-pickers/AdapterDayjs': { AdapterDayjs: 'AdapterDayjs' },
        '@mui/x-date-pickers/locales': {
            jaJP: { components: { MuiLocalizationProvider: { defaultProps: { localeText: {} } } } },
        },
        '../core/dateTimeInput': dateTime,
        './programDialogStyles': { programDialogPaper: () => ({}) },
    });
    return { component: dialog.DateTimePickerDialog, harness };
}

test('picker cancellation discards draft changes; selection and clear commit explicitly', () => {
    const commits = [];
    const closes = [];
    const { component, harness } = loadDialog();
    const props = {
        open: true,
        mode: 'datetime',
        value: '2024-02-29T23:59',
        label: '日時',
        onClose: () => closes.push(true),
        onCommit: value => commits.push(value),
    };
    let tree = harness.render(component, props);
    const timeClock = descendants(tree, node => node.type === 'TimeClock')[0];
    timeClock.props.onChange(new MockDayjs(new Date(2024, 1, 29, 1, 5)));
    tree = harness.render(component, props);
    descendants(tree, node => node.type === 'Button' && node.props.children === 'キャンセル')[0].props.onClick();
    assert.deepEqual(commits, []);
    assert.deepEqual(closes, [true]);

    props.open = false;
    harness.render(component, props);
    props.open = true;
    tree = harness.render(component, props);
    descendants(tree, node => node.type === 'DateCalendar')[0].props.onChange(
        new MockDayjs(new Date(2024, 3, 30, 0, 0)),
    );
    tree = harness.render(component, props);
    descendants(tree, node => node.type === 'TimeClock')[0].props.onChange(new MockDayjs(new Date(2024, 3, 30, 1, 5)));
    tree = harness.render(component, props);
    descendants(tree, node => node.type === 'Button' && node.props.children === '選択')[0].props.onClick();
    assert.deepEqual(commits, ['2024-04-30T01:05']);

    descendants(tree, node => node.type === 'Button' && node.props.children === 'クリア')[0].props.onClick();
    assert.deepEqual(commits, ['2024-04-30T01:05', '']);
});
