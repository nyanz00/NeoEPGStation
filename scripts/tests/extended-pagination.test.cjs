const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const helperPath = path.resolve(__dirname, '../../client/src/core/pagination/extendedPagination.ts');
const compiled = ts.transpileModule(fs.readFileSync(helperPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const loaded = new Module(helperPath, module);
loaded.filename = helperPath;
loaded.paths = Module._nodeModulePaths(path.dirname(helperPath));
loaded._compile(compiled, helperPath);
const { parsePageJump } = loaded.exports;

test('page jump accepts only an integer inside the available page range', () => {
    assert.equal(parsePageJump('1', 12), 1);
    assert.equal(parsePageJump('12', 12), 12);
    assert.equal(parsePageJump('0', 12), null);
    assert.equal(parsePageJump('13', 12), null);
    assert.equal(parsePageJump('1.5', 12), null);
    assert.equal(parsePageJump('', 12), null);
    assert.equal(parsePageJump('9007199254740992', 12), null);
});

function createHookHarness() {
    const states = [];
    let cursor = 0;
    const hooks = {
        useState(initial) {
            const index = cursor++;
            if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
            return [
                states[index],
                value => (states[index] = typeof value === 'function' ? value(states[index]) : value),
            ];
        },
        useRef(initial) {
            cursor++;
            return { current: initial };
        },
        useMemo(factory) {
            cursor++;
            return factory();
        },
        useEffect() {
            cursor++;
        },
    };
    return {
        hooks,
        render(component, props) {
            cursor = 0;
            return component(props);
        },
    };
}

function loadPaginationComponent(enabled) {
    const harness = createHookHarness();
    const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
    const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
    const materialNames = [
        'Box',
        'Button',
        'ButtonBase',
        'Dialog',
        'DialogActions',
        'DialogContent',
        'DialogContentText',
        'DialogTitle',
        'TextField',
    ];
    const material = Object.fromEntries(materialNames.map(name => [name, name]));
    material.useMediaQuery = () => false;
    const componentPath = path.resolve(__dirname, '../../client/src/components/VueCompatiblePagination.tsx');
    const compiled = ts.transpileModule(fs.readFileSync(componentPath, 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const loaded = new Module(componentPath, module);
    loaded.filename = componentPath;
    loaded.paths = Module._nodeModulePaths(path.dirname(componentPath));
    const dependencies = {
        '@mui/icons-material/ChevronLeft': { __esModule: true, default: 'ChevronLeft' },
        '@mui/icons-material/ChevronRight': { __esModule: true, default: 'ChevronRight' },
        '@mui/icons-material/FirstPage': { __esModule: true, default: 'FirstPage' },
        '@mui/icons-material/LastPage': { __esModule: true, default: 'LastPage' },
        '@mui/material': material,
        react: harness.hooks,
        'react/jsx-runtime': jsxRuntime,
        '../core/pagination/extendedPagination': { parsePageJump },
        '../core/storage/settings': { useSettings: () => ({ isExtendedPaginationEnabled: enabled }) },
        './programDialogStyles': { programDialogPaper: () => ({}) },
    };
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === componentPath && request in dependencies) return dependencies[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loaded._compile(compiled, componentPath);
    } finally {
        Module._load = originalLoad;
    }
    return { component: loaded.exports.VueCompatiblePagination, harness };
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

function paginationProps(onChange) {
    return { count: 10, page: 4, onChange };
}

test('extended pagination keeps default controls and same-page behavior when disabled', () => {
    const changes = [];
    const { component, harness } = loadPaginationComponent(false);
    const props = paginationProps((_event, page) => changes.push(page));
    const tree = harness.render(component, props);
    const buttons = descendants(tree, node => node.type === 'ButtonBase');

    assert.equal(
        buttons.some(button => ['最初のページ', '最後のページ'].includes(button.props['aria-label'])),
        false,
    );
    buttons.find(button => button.props['aria-label'] === '4ページ目').props.onClick({});
    assert.deepEqual(changes, [4]);
    assert.equal(descendants(tree, node => node.type === 'Dialog').length, 0);
});

test('extended pagination opens a jump dialog from the current page and validates submission', () => {
    const changes = [];
    const { component, harness } = loadPaginationComponent(true);
    const props = paginationProps((event, page) => changes.push({ event, page }));
    let tree = harness.render(component, props);
    descendants(tree, node => node.type === 'ButtonBase')
        .find(button => button.props['aria-label'] === '4ページ目')
        .props.onClick({});
    tree = harness.render(component, props);
    assert.equal(changes.length, 0);
    assert.equal(descendants(tree, node => node.type === 'Dialog')[0].props.open, true);

    const input = descendants(tree, node => node.type === 'TextField')[0];
    input.props.onChange({ target: { value: '11' } });
    tree = harness.render(component, props);
    descendants(tree, node => node.props.component === 'form')[0].props.onSubmit({ preventDefault() {} });
    tree = harness.render(component, props);
    assert.equal(descendants(tree, node => node.type === 'Dialog')[0].props.open, true);
    assert.equal(descendants(tree, node => node.type === 'TextField')[0].props.error, true);

    descendants(tree, node => node.type === 'TextField')[0].props.onChange({ target: { value: '8' } });
    tree = harness.render(component, props);
    descendants(tree, node => node.props.component === 'form')[0].props.onSubmit({ preventDefault() {} });
    tree = harness.render(component, props);
    assert.equal(descendants(tree, node => node.type === 'Dialog')[0].props.open, false);
    assert.deepEqual(
        changes.map(change => change.page),
        [8],
    );
});

test('extended pagination first and last controls navigate and cancel closes the jump dialog', () => {
    const changes = [];
    const { component, harness } = loadPaginationComponent(true);
    const props = paginationProps((_event, page) => changes.push(page));
    let tree = harness.render(component, props);
    const buttons = descendants(tree, node => node.type === 'ButtonBase');
    buttons.find(button => button.props['aria-label'] === '最初のページ').props.onClick({});
    buttons.find(button => button.props['aria-label'] === '最後のページ').props.onClick({});
    assert.deepEqual(changes, [1, 10]);

    buttons.find(button => button.props['aria-label'] === '4ページ目').props.onClick({});
    tree = harness.render(component, props);
    descendants(tree, node => node.type === 'Button' && node.props.children === 'キャンセル')[0].props.onClick();
    tree = harness.render(component, props);
    assert.equal(descendants(tree, node => node.type === 'Dialog')[0].props.open, false);
    assert.deepEqual(changes, [1, 10]);
});
