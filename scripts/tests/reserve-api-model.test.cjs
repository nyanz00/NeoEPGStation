const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

const sourcePath = path.resolve(__dirname, '../../src/model/api/reserve/ReserveApiModel.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const load = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath && request.startsWith('.')) {
        return {};
    }
    return load.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = load;
}
const ReserveApiModel = loadedModule.exports.default;

function createReserve(overrides = {}) {
    return {
        id: 1,
        userId: null,
        isSkip: false,
        isConflict: false,
        isOverlap: false,
        allowEndLack: false,
        isTimeSpecified: false,
        isDeleteOriginalAfterEncode: false,
        updateThumbnail: false,
        channelId: 1,
        startAt: 100,
        endAt: 200,
        name: 'Program',
        halfWidthName: 'Program',
        ruleId: null,
        tags: null,
        parentDirectoryName: null,
        directory: null,
        recordedFormat: null,
        encodeMode1: null,
        encodeParentDirectoryName1: null,
        encodeDirectory1: null,
        encodeMode2: null,
        encodeParentDirectoryName2: null,
        encodeDirectory2: null,
        encodeMode3: null,
        encodeParentDirectoryName3: null,
        encodeDirectory3: null,
        programId: null,
        description: null,
        halfWidthDescription: null,
        extended: null,
        halfWidthExtended: null,
        rawExtended: null,
        rawHalfWidthExtended: null,
        genre1: null,
        subGenre1: null,
        genre2: null,
        subGenre2: null,
        genre3: null,
        subGenre3: null,
        videoType: null,
        videoResolution: null,
        videoStreamContent: null,
        videoComponentType: null,
        audioSamplingRate: null,
        audioComponentType: null,
        ...overrides,
    };
}

test('reserve items return encode directories 2 and 3 from their matching fields', () => {
    const model = Object.create(ReserveApiModel.prototype);

    const result = model.toReserveItem(
        createReserve({ encodeDirectory2: 'encode-2', encodeDirectory3: 'encode-3' }),
        false,
    );

    assert.equal(result.encodeDirectory2, 'encode-2');
    assert.equal(result.encodeDirectory3, 'encode-3');
});

test('reserve items return audio component type when present', () => {
    const model = Object.create(ReserveApiModel.prototype);

    const result = model.toReserveItem(createReserve({ audioComponentType: 3 }), false);

    assert.equal(result.audioComponentType, 3);
});
