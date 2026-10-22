const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ts = require('typescript');
require('reflect-metadata');

const sourcePath = path.resolve(__dirname, '../../src/model/operator/reservation/ReservationManageModel.ts');
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
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath) {
        if (request === 'inversify') {
            return { inject: () => () => {}, injectable: () => target => target };
        }
        if (request.startsWith('.')) return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const ReservationManageModel = loadedModule.exports.default;

function createLogger() {
    const noop = () => {};
    return { system: { debug: noop, error: noop, info: noop, warn: noop } };
}

function createModel(overrides = {}) {
    const calls = { getExecution: 0, findId: 0, findProgramId: 0, createDiff: null };
    const model = Object.assign(Object.create(ReservationManageModel.prototype), {
        log: createLogger(),
        optionChecker: { checkEncodeOption: () => false },
        executeManagementModel: {
            getExecution: async () => {
                calls.getExecution++;
                return 1;
            },
            unLockExecution: () => {},
        },
        reserveDB: {
            findId: async () => {
                calls.findId++;
                return null;
            },
            findProgramId: async () => {
                calls.findProgramId++;
                return [];
            },
        },
        reserveEvent: { emitUpdated: () => {} },
        createDiff: async (...args) => {
            calls.createDiff = args;
            return {};
        },
        tuners: [{ add: () => true, clear: () => {}, reset: () => {} }],
        ...overrides,
    });
    return { model, calls };
}

function createReserve(overrides = {}) {
    return {
        id: 1,
        programId: 777,
        ruleId: 1,
        isEventRelay: false,
        isSkip: false,
        isConflict: false,
        isOverlap: false,
        isTimeSpecified: false,
        updateTime: 1,
        startAt: 100,
        endAt: 200,
        name: 'Program',
        ...overrides,
    };
}

test('invalid add encode options reject before execution or database access', async () => {
    for (const option of [
        { programId: 777, encodeOption: {} },
        { timeSpecifiedOption: {}, encodeOption: {} },
    ]) {
        const { model, calls } = createModel();
        await assert.rejects(model.add(option), /AddReservationOptionError/);
        assert.equal(calls.getExecution, 0);
        assert.equal(calls.findId, 0);
        assert.equal(calls.findProgramId, 0);
    }
});

test('invalid edit encode options reject before reserve lookup; valid manual options without encoding remain valid', async () => {
    const { model, calls } = createModel();
    await assert.rejects(model.edit(1, { encodeOption: {} }), /ReservationEditError/);
    assert.equal(calls.findId, 0);

    assert.equal(model.checkManualReserveOption({ programId: 777 }), true);
    assert.equal(model.checkManualReserveOption({ timeSpecifiedOption: {} }), true);
});

test('createReserves keeps skips, manual and relay entries, while suppressing regular and overlap matches', () => {
    const { model } = createModel();
    const regular = [createReserve({ id: 1, ruleId: 1 }), createReserve({ id: 2, ruleId: 2 })];
    assert.deepEqual(
        model.createReserves(regular).map(reserve => reserve.id),
        [1],
    );

    const skipped = [
        createReserve({ id: 3, ruleId: 1, isSkip: true }),
        createReserve({ id: 4, ruleId: 2, isSkip: true }),
    ];
    assert.deepEqual(
        model.createReserves(skipped).map(reserve => reserve.id),
        [3, 4],
    );

    const mixed = [
        createReserve({ id: 5, ruleId: 1, isSkip: true }),
        createReserve({ id: 6, ruleId: 2, isSkip: true }),
        createReserve({ id: 7, ruleId: 3, isSkip: false }),
        createReserve({ id: 8, ruleId: 4, isOverlap: true }),
        createReserve({ id: 9, ruleId: null }),
        createReserve({ id: 10, ruleId: 5, isEventRelay: true }),
        createReserve({ id: 11, ruleId: 6, programId: 888 }),
    ];
    assert.deepEqual(
        model.createReserves(mixed).map(reserve => reserve.id),
        [9, 5, 6, 10, 11],
    );
});

test('removeSkip clears sibling rule skips and createDiff does not re-add them from its base query', async () => {
    const target = createReserve({ id: 10, isSkip: true });
    const sibling = createReserve({ id: 11, ruleId: 2, isSkip: true });
    const calls = { findProgramId: 0, findTimeRanges: null, createDiff: null, updateMany: null };
    const { model } = createModel({
        reserveDB: {
            findId: async () => target,
            findProgramId: async () => {
                calls.findProgramId++;
                return [target, sibling];
            },
            findTimeRanges: async option => {
                calls.findTimeRanges = option;
                return [target, sibling];
            },
            updateMany: async diff => {
                calls.updateMany = diff;
            },
        },
    });
    const realCreateDiff = ReservationManageModel.prototype.createDiff;
    model.createDiff = async (...args) => {
        calls.createDiff = args;
        return realCreateDiff.apply(model, args);
    };

    await model.removeSkip(target.id);

    assert.equal(calls.findProgramId, 1);
    assert.ok(calls.createDiff);
    const [, newReserves, oldReserves] = calls.createDiff;
    assert.deepEqual(
        oldReserves.map(reserve => reserve.id),
        [10, 11],
    );
    assert.deepEqual(
        oldReserves.map(reserve => reserve.isSkip),
        [true, true],
    );
    assert.deepEqual(
        newReserves.map(reserve => reserve.id),
        [10, 11],
    );
    assert.deepEqual(
        newReserves.map(reserve => reserve.isSkip),
        [false, false],
    );
    assert.equal(calls.findTimeRanges.hasSkip, true);
    assert.equal(calls.findTimeRanges.hasOverlap, true);
    assert.deepEqual(
        calls.updateMany.update.map(reserve => [reserve.id, reserve.isSkip]),
        [[10, false]],
    );
    assert.deepEqual(
        calls.updateMany.delete.map(reserve => reserve.id),
        [11],
    );
});
