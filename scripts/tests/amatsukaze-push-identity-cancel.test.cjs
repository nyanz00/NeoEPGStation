const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

const sourcePath = path.resolve(__dirname, '../../src/model/service/encode/EncoderModel.ts');
const source = fs
    .readFileSync(sourcePath, 'utf8')
    .replace('class AmatsukazePushConnection {', 'export class AmatsukazePushConnection {')
    .replace('class AmatsukazePushSubscription {', 'export class AmatsukazePushSubscription {');
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
let sleepImplementation = async () => undefined;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath && request === '../../../util/Util') {
        return { __esModule: true, default: { sleep: (...args) => sleepImplementation(...args) } };
    }
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

const { default: EncoderModel, AmatsukazePushSubscription } = loadedModule.exports;
const inputPath = 'C:\\Recordings\\日本語\\program.ts';

function queueItem(id, srcPath, state = 'Encoding') {
    return `<QueueItem><ConsoleId>-1</ConsoleId><Id>${id}</Id><SrcPath>${srcPath}</SrcPath><State>${state}</State><StateLabel>${state}</StateLabel><FailReason></FailReason></QueueItem>`;
}

function queueData(...items) {
    return `<UIData><QueueData><Items>${items.join('')}</Items></QueueData></UIData>`;
}

function createSubscription(initialTaskId = null, allowRecoveryFallback = false) {
    const sentTaskIds = [];
    const matchedTaskIds = [];
    const connection = {
        canClaimTask: () => true,
        claimConsoleFromQueue: () => undefined,
        createChangeItemFrame: taskId => ({ taskId }),
        sendFrame: frame => {
            sentTaskIds.push(frame.taskId);
            return true;
        },
        unsubscribe: () => undefined,
    };
    const subscription = new AmatsukazePushSubscription(
        1,
        connection,
        inputPath,
        initialTaskId,
        null,
        allowRecoveryFallback,
        () => undefined,
        taskId => matchedTaskIds.push(taskId),
        () => undefined,
    );
    return { subscription, sentTaskIds, matchedTaskIds };
}

test('a reused saved Amatsukaze task ID is accepted only for the normalized source path', () => {
    const { subscription, matchedTaskIds } = createSubscription(12);

    subscription.handleUIData(queueData(queueItem(12, 'C:/other/program.ts'), queueItem(15, inputPath)));

    assert.equal(subscription.getTaskId(), 15);
    assert.deepEqual(matchedTaskIds, [15]);
});

test('a verified saved ID remains authoritative when the same source has other history', () => {
    const { subscription, matchedTaskIds } = createSubscription(12);

    subscription.handleUIData(queueData(queueItem(12, inputPath, 'Complete'), queueItem(15, inputPath, 'Encoding')));

    assert.equal(subscription.getTaskId(), 12);
    assert.deepEqual(matchedTaskIds, []);
});

test('path fallback prefers an active task over terminal history for the same source', () => {
    const { subscription, matchedTaskIds } = createSubscription();

    subscription.handleUIData(queueData(queueItem(12, inputPath, 'Complete'), queueItem(15, inputPath, 'Encoding')));

    assert.equal(subscription.getTaskId(), 15);
    assert.deepEqual(matchedTaskIds, [15]);
});

test('cancel waits for a matching task and a Canceled queue state', async () => {
    const { subscription, sentTaskIds } = createSubscription(12);
    const cancelPromise = subscription.cancelTask(1000);

    assert.deepEqual(sentTaskIds, []);
    subscription.handleUIData(queueData(queueItem(12, inputPath)));
    assert.deepEqual(sentTaskIds, [12]);

    let isSettled = false;
    void cancelPromise.finally(() => {
        isSettled = true;
    });
    await Promise.resolve();
    assert.equal(isSettled, false);

    subscription.handleUIData(queueData(queueItem(12, inputPath, 'Canceled')));
    assert.equal(await cancelPromise, 12);
});

test('cancel confirmation stays on the verified task when another same-path task is active', async () => {
    const { subscription, sentTaskIds } = createSubscription(12);
    subscription.handleUIData(queueData(queueItem(12, inputPath)));
    const cancelPromise = subscription.cancelTask(1000);

    subscription.handleUIData(queueData(queueItem(12, inputPath, 'Canceled'), queueItem(15, inputPath, 'Encoding')));

    assert.equal(await cancelPromise, 12);
    assert.equal(subscription.getTaskId(), 12);
    assert.deepEqual(sentTaskIds, [12]);
});

test('cancel never targets a reused ID that now belongs to a different source path', async () => {
    const { subscription, sentTaskIds } = createSubscription(12);
    const cancelPromise = subscription.cancelTask(1000);

    subscription.handleUIData(queueData(queueItem(12, 'C:/Recordings/other.ts'), queueItem(15, inputPath)));

    assert.deepEqual(sentTaskIds, [15]);
    subscription.handleUIData(queueData(queueItem(15, inputPath, 'Canceled')));
    assert.equal(await cancelPromise, 15);
});

test('cancel re-resolves and cancels a new ID after the Push connection reconnects', async () => {
    const { subscription, sentTaskIds, matchedTaskIds } = createSubscription(12);
    subscription.handleUIData(queueData(queueItem(12, inputPath)));
    const cancelPromise = subscription.cancelTask(1000);

    subscription.handleConnectionStatus(false);
    subscription.handleConnectionStatus(true);
    subscription.handleUIData(queueData(queueItem(42, 'C:/Recordings/日本語/program.ts')));

    assert.deepEqual(matchedTaskIds, [42]);
    assert.deepEqual(sentTaskIds, [12, 42]);
    subscription.handleUIData(queueData(queueItem(42, inputPath, 'Canceled')));
    assert.equal(await cancelPromise, 42);
});

test('cancel retries the same ID after an unconfirmed Push disconnect', async () => {
    const { subscription, sentTaskIds } = createSubscription(12);
    subscription.handleUIData(queueData(queueItem(12, inputPath)));
    const cancelPromise = subscription.cancelTask(1000);

    subscription.handleConnectionStatus(false);
    subscription.handleConnectionStatus(true);
    subscription.handleUIData(queueData(queueItem(12, inputPath)));

    assert.deepEqual(sentTaskIds, [12, 12]);
    subscription.handleUIData(queueData(queueItem(12, inputPath, 'Canceled')));
    assert.equal(await cancelPromise, 12);
});

test('cancel reports completion instead of treating a failed cancel as success', async () => {
    const { subscription, sentTaskIds } = createSubscription(12);
    subscription.handleUIData(queueData(queueItem(12, inputPath, 'Complete')));

    await assert.rejects(subscription.cancelTask(), /AmatsukazeTaskNotActive: complete/);
    assert.deepEqual(sentTaskIds, []);
});

test('cancel reports an unresolved or unconfirmed task after the timeout', async () => {
    const { subscription, sentTaskIds } = createSubscription(12);

    await assert.rejects(subscription.cancelTask(5), /AmatsukazeCancelConfirmationTimeoutError/);
    assert.deepEqual(sentTaskIds, []);
});

test('a late Canceled state after confirmation timeout is still classified as cancellation', async () => {
    const { subscription } = createSubscription(12);
    subscription.handleUIData(queueData(queueItem(12, inputPath)));

    await assert.rejects(subscription.cancelTask(5), /AmatsukazeCancelConfirmationTimeoutError/);
    subscription.handleUIData(queueData(queueItem(12, inputPath, 'Canceled')));

    assert.equal(subscription.getStatus().isCanceled, true);
    assert.equal(subscription.getStatus().errorMessage, null);
});

test('an unconfirmed automatic pending cancellation keeps monitoring the task', async () => {
    const encoder = Object.create(EncoderModel.prototype);
    let sleepCount = 0;
    let cancelAttempts = 0;
    let progressUpdates = 0;
    encoder.isCanceld = false;
    encoder.progressInfo = null;
    encoder.encodeOption = {};
    encoder.amatsukazePushSubscription = {
        getTaskId: () => 12,
        getStatus: () => ({
            isPending: true,
            pendingMessage: 'waiting',
            errorMessage: null,
            isReadyForOutputScan: false,
            requiresOutputReconcile: false,
        }),
    };
    encoder.cancelAmatsukazeTask = async () => {
        cancelAttempts += 1;
        throw new Error('confirmation timeout');
    };
    encoder.encodeEvent = { emitUpdateEncodeProgress: () => (progressUpdates += 1) };
    encoder.log = { encode: { info() {}, warn() {} } };
    sleepImplementation = async () => {
        sleepCount += 1;
        await new Promise(resolve => setTimeout(resolve, 2));
        if (sleepCount >= 2) encoder.isCanceld = true;
    };

    await assert.rejects(
        encoder.waitForAmatsukazeOutput(
            { waitIntervalSec: 0.001, pendingTimeoutSec: 0.001 },
            'C:\\output.mkv',
            inputPath,
            'C:\\output',
            Date.now(),
        ),
        /AmatsukazeEncodeCanceled/,
    );

    assert.equal(cancelAttempts, 1);
    assert.equal(encoder.progressInfo.log, 'Amatsukazeのキャンセル結果を確認できないため監視を継続中');
    assert.ok(progressUpdates >= 2);
});
