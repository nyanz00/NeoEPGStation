const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function createHookHarness() {
    let states = [];
    let refs = [];
    let memos = [];
    let cursor = 0;
    const hooks = {
        useState(initial) {
            const index = cursor++;
            if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
            return [
                states[index],
                value => {
                    states[index] = typeof value === 'function' ? value(states[index]) : value;
                },
            ];
        },
        useRef(initial) {
            const index = cursor++;
            if (!(index in refs)) refs[index] = { current: initial };
            return refs[index];
        },
        useMemo(factory, dependencies) {
            const index = cursor++;
            const previous = memos[index];
            if (
                previous === undefined ||
                previous.dependencies.length !== dependencies.length ||
                !previous.dependencies.every((value, i) => Object.is(value, dependencies[i]))
            ) {
                memos[index] = { dependencies, value: factory() };
            }
            return memos[index].value;
        },
        useCallback(callback, dependencies) {
            return hooks.useMemo(() => callback, dependencies);
        },
        useContext(context) {
            return context.value;
        },
        createContext(value) {
            return { value, Provider: 'ContextProvider' };
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

function loadNotifications(harness) {
    const absolutePath = path.resolve(__dirname, '../../client/src/core/notifications/Notifications.tsx');
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
    const dependencies = {
        '@mui/material': { Alert: 'Alert', Snackbar: 'Snackbar' },
        react: harness.hooks,
        'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    };
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath && request in dependencies) return dependencies[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports;
}

function descendants(node, type, result = []) {
    if (Array.isArray(node)) {
        for (const child of node) descendants(child, type, result);
    } else if (node && typeof node === 'object') {
        if (node.type === type) result.push(node);
        descendants(node.props?.children, type, result);
    }
    return result;
}

test('notifications get a fresh timer key and stale close callbacks cannot dismiss a newer notice', () => {
    const harness = createHookHarness();
    const { NotificationProvider } = loadNotifications(harness);
    const render = () => harness.render(NotificationProvider, { children: null });
    const getNotification = tree => {
        const snackbar = descendants(tree, 'Snackbar')[0];
        const alert = descendants(tree, 'Alert')[0];
        assert.ok(snackbar);
        assert.ok(alert);
        return { snackbar, alert };
    };

    const firstTree = render();
    const first = getNotification(firstTree);
    const notify = firstTree.props.value.notify;
    notify('first', 'warning');
    const firstNotice = getNotification(render());
    assert.equal(firstNotice.snackbar.props.autoHideDuration, 3_000);
    assert.equal(firstNotice.snackbar.props.disableWindowBlurListener, true);
    assert.equal(firstNotice.alert.props.severity, 'warning');
    assert.equal(firstNotice.alert.props.children, 'first');

    notify('second', 'error');
    const secondTree = render();
    const secondNotice = getNotification(secondTree);
    assert.notEqual(secondNotice.snackbar.key, firstNotice.snackbar.key);
    assert.equal(secondNotice.alert.props.children, 'second');

    firstNotice.snackbar.props.onClose();
    const afterStaleClose = getNotification(render());
    assert.equal(afterStaleClose.alert.props.children, 'second');

    afterStaleClose.alert.props.onClose();
    const closed = getNotification(render());
    assert.equal(closed.snackbar.props.open, false);
    assert.equal(closed.alert.props.children, undefined);
    assert.equal(first.snackbar.props.open, false);
});
