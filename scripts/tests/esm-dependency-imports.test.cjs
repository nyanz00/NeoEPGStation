const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isBuiltin } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');

function javascriptFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) return javascriptFiles(filename);
        return entry.isFile() && filename.endsWith('.js') ? [filename] : [];
    });
}

test('compiled ESM imports expose the external dependency APIs used at runtime', async () => {
    const packages = new Map();
    const failures = [];
    for (const filename of javascriptFiles(path.join(root, 'dist'))) {
        const source = ts.createSourceFile(
            filename,
            fs.readFileSync(filename, 'utf8'),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.JS,
        );
        for (const statement of source.statements) {
            if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
            const specifier = statement.moduleSpecifier.text;
            if (specifier.startsWith('.') || isBuiltin(specifier)) continue;
            if (!packages.has(specifier)) packages.set(specifier, await import(specifier));
            const namespace = packages.get(specifier);
            const clause = statement.importClause;
            const location = `${path.relative(root, filename)}: ${specifier}`;
            const check = (condition, message) => {
                if (!condition) failures.push(`${location}: ${message}`);
            };
            if (clause.name) check(namespace.default !== undefined, 'default export is missing');
            const bindings = clause.namedBindings;
            if (bindings && ts.isNamedImports(bindings)) {
                for (const binding of bindings.elements) {
                    const member = (binding.propertyName ?? binding.name).text;
                    check(member in namespace, `named export ${member} is missing`);
                }
            }
            const namespaceAlias = bindings && ts.isNamespaceImport(bindings) ? bindings.name.text : undefined;
            const defaultAlias = clause.name?.text;
            function visit(node) {
                if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
                    const alias = node.expression.text;
                    const member = node.name.text;
                    if (alias === namespaceAlias) {
                        check(member in namespace, `namespace export ${member} is missing`);
                    } else if (alias === defaultAlias) {
                        check(namespace.default?.[member] !== undefined, `default.${member} is missing`);
                    }
                }
                if (
                    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
                    ts.isIdentifier(node.expression) &&
                    node.expression.text === defaultAlias
                ) {
                    check(typeof namespace.default === 'function', 'default export cannot be called or constructed');
                }
                ts.forEachChild(node, visit);
            }
            visit(source);
        }
    }
    assert.ok(packages.has('file-type'), 'the playback MIME dependency must be checked');
    assert.deepEqual([...new Set(failures)], []);
});
