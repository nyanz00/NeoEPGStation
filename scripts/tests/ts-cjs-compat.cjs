'use strict';

// Keep source-transpile tests loading local TypeScript modules through their legacy CJS mocks
// while production source uses NodeNext ESM specifiers.
const tsPath = require.resolve('typescript');
const ts = require(tsPath);
const transpileModule = ts.transpileModule;
const cacheEntry = require.cache[tsPath];

cacheEntry.exports = new Proxy(ts, {
    get(target, property, receiver) {
        if (property !== 'transpileModule') return Reflect.get(target, property, receiver);
        return (input, options) => {
            const source = input
                .replace(/\bimport\.meta\.url\b/g, "require('node:url').pathToFileURL(__filename).href")
                .replace(/\bimport\.meta\.dirname\b/g, '__dirname')
                .replace(/((?:from\s*|import\s*|require\()\s*['"])(\.{1,2}\/[^'"]+)\.js(['"])/g, '$1$2$3');
            return transpileModule.call(target, source, options);
        };
    },
});
