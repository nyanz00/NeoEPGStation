'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/ExecutionManagementModel.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
        experimentalDecorators: true,
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;

function loadExecutionManagementModel() {
    const fixedTimestamp = 1_700_000_000_000;
    class FixedDate extends Date {
        constructor(...args) {
            super(...(args.length === 0 ? [fixedTimestamp] : args));
        }

        static now() {
            return fixedTimestamp;
        }
    }
    const fixedMath = Object.create(Math);
    fixedMath.random = () => 0.25;

    let nextTimerId = 0;
    const timers = new Map();
    const scheduleTimeout = (callback, delay) => {
        const id = ++nextTimerId;
        timers.set(id, { callback, delay });
        return id;
    };
    const clearTimeout = id => timers.delete(id);
    const loaded = { exports: {} };
    const noopParameterDecorator = () => () => undefined;
    const inversify = {
        inject: noopParameterDecorator,
        injectable: () => target => target,
    };
    const sandbox = {
        clearTimeout,
        Date: FixedDate,
        exports: loaded.exports,
        Math: fixedMath,
        module: loaded,
        require(request) {
            if (request === 'inversify') return inversify;
            return require(request);
        },
        setTimeout: scheduleTimeout,
    };

    vm.runInNewContext(compiled, sandbox, { filename: sourcePath });

    const errorLogs = [];
    const loggerModel = {
        getLogger: () => ({ system: { error: message => errorLogs.push(message) } }),
    };
    return {
        ExecutionManagementModel: loaded.exports.default,
        errorLogs,
        makeModel: () => new loaded.exports.default(loggerModel),
        timers,
    };
}

function observe(promise) {
    let settled = false;
    const outcome = Promise.resolve(promise).then(
        value => {
            settled = true;
            return { status: 'fulfilled', value };
        },
        reason => {
            settled = true;
            return { status: 'rejected', reason };
        },
    );
    return {
        outcome,
        get settled() {
            return settled;
        },
    };
}

function fireTimeout(timers, delay) {
    const entries = [...timers.entries()].filter(([, timer]) => timer.delay === delay);
    assert.equal(entries.length, 1, `expected one pending ${delay}ms timer`);
    const [id, timer] = entries[0];
    timers.delete(id);
    timer.callback();
}

test('fixed time and randomness still produce distinct execution ids in lock order', async () => {
    const { makeModel } = loadExecutionManagementModel();
    const model = makeModel();

    const firstId = await model.getExecution(1, 100);
    const second = observe(model.getExecution(1, 200));
    const third = observe(model.getExecution(1, 300));
    await Promise.resolve();

    assert.equal(second.settled, false, 'the second request must wait for the first lock');
    assert.equal(third.settled, false, 'the third request must wait behind the second');

    model.unLockExecution(firstId);
    const secondOutcome = await second.outcome;
    assert.equal(secondOutcome.status, 'fulfilled');
    assert.notEqual(secondOutcome.value, firstId);
    assert.equal(third.settled, false, 'the third request must remain queued while the second holds the lock');

    model.unLockExecution(secondOutcome.value);
    const thirdOutcome = await third.outcome;
    assert.equal(thirdOutcome.status, 'fulfilled');
    assert.notEqual(thirdOutcome.value, secondOutcome.value);
    assert.notEqual(thirdOutcome.value, firstId);
    model.unLockExecution(thirdOutcome.value);
});

test('a timed-out waiter is removed and cannot block the next execution', async () => {
    const { errorLogs, makeModel, timers } = loadExecutionManagementModel();
    const model = makeModel();

    const firstId = await model.getExecution(1, 100);
    const timedOut = observe(model.getExecution(1, 10));
    const successor = observe(model.getExecution(1, 20));
    await Promise.resolve();

    assert.equal(timedOut.settled, false, 'the queued request must wait for the current lock');
    assert.equal(successor.settled, false, 'the later queued request must also wait');

    fireTimeout(timers, 10);
    const timedOutOutcome = await timedOut.outcome;
    assert.equal(timedOutOutcome.status, 'rejected');
    assert.equal(timedOutOutcome.reason.message, 'GetExecutionTimeoutError');
    assert.equal(successor.settled, false, 'timing out one waiter must not grant or lose the current lock');

    model.unLockExecution(firstId);
    const successorOutcome = await successor.outcome;
    assert.equal(successorOutcome.status, 'fulfilled', 'the next waiter must acquire after the current lock releases');
    assert.notEqual(successorOutcome.value, firstId);
    model.unLockExecution(successorOutcome.value);

    const followingId = await model.getExecution(1, 30);
    assert.notEqual(followingId, firstId);
    assert.notEqual(followingId, successorOutcome.value);
    model.unLockExecution(followingId);
    assert.deepEqual(errorLogs, ['get execution error: 1']);
});

test('a queued cancel at priority 4 runs before a queued start at priority 2', async () => {
    const { makeModel } = loadExecutionManagementModel();
    const model = makeModel();

    const currentId = await model.getExecution(0, 100);
    const start = observe(model.getExecution(2, 200));
    const cancel = observe(model.getExecution(4, 300));
    await Promise.resolve();

    assert.equal(start.settled, false, 'start waits for the current execution');
    assert.equal(cancel.settled, false, 'cancel also waits for the current execution');

    model.unLockExecution(currentId);
    const cancelOutcome = await cancel.outcome;
    assert.equal(cancelOutcome.status, 'fulfilled');
    assert.equal(start.settled, false, 'the lower-priority start remains queued while cancel holds the lock');

    model.unLockExecution(cancelOutcome.value);
    const startOutcome = await start.outcome;
    assert.equal(startOutcome.status, 'fulfilled');
    model.unLockExecution(startOutcome.value);
});
