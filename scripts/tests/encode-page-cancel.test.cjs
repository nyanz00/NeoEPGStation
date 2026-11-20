const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../../client/src/pages/EncodePage.tsx');
const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
);
let callback;
function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'cancel') {
        callback = node.initializer.arguments[0].properties.find(
            property => property.name.getText(source) === 'onSuccess',
        ).initializer;
    }
    ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback);
const compiled = ts.transpileModule(`const handle = ${callback.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;

test('single cancellation failure preserves normal view while bulk failure keeps only failed ids selected', async () => {
    for (const editing of [false, true]) {
        for (const fails of [false, true]) {
            const state = { editing, selected: new Set([1, 2]), targets: [1, 2] };
            const context = {
                editing,
                setTargets: value => {
                    state.targets = value;
                },
                setSelected: value => {
                    state.selected = value;
                },
                setEditing: update => {
                    state.editing = update(state.editing);
                },
                notify() {},
                queryClient: { invalidateQueries: async () => {} },
            };
            vm.createContext(context);
            vm.runInContext(compiled, context);
            await vm.runInContext(
                'handle',
                context,
            )({
                succeeded: [1],
                failed: fails ? [{ id: 2, result: { status: 'rejected', reason: new Error('stop unconfirmed') } }] : [],
            });
            assert.equal(state.editing, editing && fails);
            assert.deepEqual([...state.selected], editing && fails ? [2] : []);
            assert.equal(state.targets.length, 0);
        }
    }
});
