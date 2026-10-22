const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

function loadTypeScript(relativePath) {
    const absolutePath = path.resolve(__dirname, '../..', relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
        fileName: absolutePath,
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    loadedModule._compile(compiled, absolutePath);
    return loadedModule.exports.default;
}

const WallClockScheduler = loadTypeScript('src/util/WallClockScheduler.ts');

function withFakeClock(run) {
    const originalNow = Date.now;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let now = 1000;
    let nextId = 0;
    const timers = new Map();
    Date.now = () => now;
    global.setTimeout = (callback, delay) => {
        const id = ++nextId;
        timers.set(id, { callback, delay });
        return id;
    };
    global.clearTimeout = id => timers.delete(id);

    const clock = {
        now: () => now,
        setNow: value => (now = value),
        nextDelay: () => Array.from(timers.values())[0]?.delay,
        fire: () => {
            const [id, timer] = timers.entries().next().value ?? [];
            assert.notEqual(id, undefined, 'expected a pending timer');
            timers.delete(id);
            timer.callback();
        },
        timerCount: () => timers.size,
    };
    const restore = () => {
        Date.now = originalNow;
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    };
    try {
        const result = run(clock);
        if (result != null && typeof result.then === 'function') {
            return result.finally(restore);
        }
        restore();
        return result;
    } catch (error) {
        restore();
        throw error;
    }
}

test('uses one timer and periodically rechecks wall clock up to maxDelayMs', () =>
    withFakeClock(clock => {
        const scheduler = new WallClockScheduler(3000);
        scheduler.schedule('later', clock.now() + 12000, () => {});
        assert.equal(clock.timerCount(), 1);
        assert.equal(clock.nextDelay(), 3000);
        clock.setNow(clock.now() + 2500);
        clock.fire();
        assert.equal(clock.timerCount(), 1);
        assert.equal(clock.nextDelay(), 3000);
        scheduler.dispose();
        assert.equal(clock.timerCount(), 0);
    }));

test('updates entries safely and stale cancellation cannot remove a replacement', () =>
    withFakeClock(clock => {
        const scheduler = new WallClockScheduler();
        const calls = [];
        const cancelOld = scheduler.schedule('key', clock.now() + 5000, () => calls.push('old'));
        scheduler.schedule('key', clock.now() + 1000, () => calls.push('new'));
        cancelOld();
        clock.setNow(clock.now() + 1000);
        scheduler.refresh();
        assert.deepEqual(calls, []);
        clock.fire();
        assert.deepEqual(calls, ['new']);
        assert.equal(clock.timerCount(), 0);
        scheduler.dispose();
    }));

test('runs all due callbacks despite sync throws and rejected promises; callbacks may reschedule', async () =>
    await withFakeClock(async clock => {
        const errors = [];
        const calls = [];
        const scheduler = new WallClockScheduler(3000, error => errors.push(error.message));
        scheduler.schedule('throw', clock.now(), () => {
            calls.push('throw');
            throw new Error('sync');
        });
        scheduler.schedule('reject', clock.now(), () => {
            calls.push('reject');
            return Promise.reject(new Error('async'));
        });
        scheduler.schedule('reschedule', clock.now(), () => {
            calls.push('first');
            scheduler.schedule('reschedule', clock.now(), () => calls.push('again'));
        });
        scheduler.refresh();
        assert.deepEqual(calls, []);
        clock.fire();
        await Promise.resolve();
        assert.equal(clock.timerCount(), 1);
        clock.fire();
        assert.deepEqual(calls, ['throw', 'reject', 'first', 'again']);
        assert.deepEqual(errors, ['sync', 'async']);
        scheduler.dispose();
    }));

test('past deadlines run asynchronously so callers can retain their cancellation handle', () =>
    withFakeClock(clock => {
        const scheduler = new WallClockScheduler();
        const calls = [];
        const cancel = scheduler.schedule('past', clock.now() - 1, () => calls.push('called'));
        assert.equal(typeof cancel, 'function');
        assert.deepEqual(calls, []);
        assert.equal(clock.timerCount(), 1);
        cancel();
        assert.deepEqual(calls, []);
        assert.equal(clock.timerCount(), 0);
        scheduler.schedule('past-run', clock.now() - 1, () => calls.push('async'));
        assert.deepEqual(calls, []);
        clock.fire();
        assert.deepEqual(calls, ['async']);
        scheduler.dispose();
    }));

test('past reschedules run in later ticks without recursion or duplicate timers', () =>
    withFakeClock(clock => {
        const scheduler = new WallClockScheduler();
        let calls = 0;
        const scheduleAgain = () => {
            calls++;
            if (calls < 12) {
                scheduler.schedule('repeat', clock.now(), scheduleAgain);
            }
        };
        scheduler.schedule('repeat', clock.now(), scheduleAgain);

        for (let i = 0; i < 12; i++) {
            assert.equal(calls, i);
            assert.equal(clock.timerCount(), 1);
            clock.fire();
            assert.equal(clock.timerCount(), i < 11 ? 1 : 0);
        }
        assert.equal(calls, 12);
        scheduler.dispose();
    }));

test('rejects invalid deadlines and intervals; cancel and dispose clear pending work', () =>
    withFakeClock(clock => {
        assert.throws(() => new WallClockScheduler(0), RangeError);
        assert.throws(() => new WallClockScheduler(Infinity), RangeError);
        const scheduler = new WallClockScheduler();
        assert.throws(() => scheduler.schedule('invalid', NaN, () => {}), RangeError);
        scheduler.schedule('cancel', clock.now() + 10000, () => {});
        assert.equal(clock.timerCount(), 1);
        scheduler.cancel('cancel');
        assert.equal(clock.timerCount(), 0);
        scheduler.schedule('dispose', clock.now() + 10000, () => {});
        scheduler.dispose();
        assert.equal(clock.timerCount(), 0);
        assert.throws(() => scheduler.schedule('after-dispose', clock.now(), () => {}), /disposed/);
    }));
