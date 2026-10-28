'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    DEFAULT_MAX_WORKERS,
    DEFAULT_MEMORY_PER_WORKER_BYTES,
    getBuildEnvironment,
    getResourcePlan,
    getWorkerLimit,
} = require('../preflight-resources.cjs');

test('worker limit is bounded by CPU, memory, and the configured maximum', () => {
    assert.equal(
        getWorkerLimit({
            availableParallelism: 16,
            totalMemoryBytes: 4 * DEFAULT_MEMORY_PER_WORKER_BYTES,
        }),
        4,
    );
    assert.equal(
        getWorkerLimit({
            availableParallelism: 2,
            totalMemoryBytes: 16 * DEFAULT_MEMORY_PER_WORKER_BYTES,
        }),
        2,
    );
    assert.equal(
        getWorkerLimit({
            availableParallelism: 32,
            totalMemoryBytes: 32 * DEFAULT_MEMORY_PER_WORKER_BYTES,
        }),
        DEFAULT_MAX_WORKERS,
    );
});

test('worker limit always leaves one worker for constrained or small hosts', () => {
    assert.equal(
        getWorkerLimit({
            availableParallelism: 0,
            totalMemoryBytes: 0,
        }),
        1,
    );
    assert.equal(
        getWorkerLimit({
            availableParallelism: 8,
            totalMemoryBytes: DEFAULT_MEMORY_PER_WORKER_BYTES - 1,
        }),
        1,
    );
});

test('resource plan reports the detected resources and calculated worker count', () => {
    assert.deepEqual(
        getResourcePlan({
            availableParallelism: 6,
            totalMemoryBytes: 3 * DEFAULT_MEMORY_PER_WORKER_BYTES,
        }),
        {
            availableParallelism: 6,
            totalMemoryBytes: 3 * DEFAULT_MEMORY_PER_WORKER_BYTES,
            maxWorkers: 3,
        },
    );
});

test('build environment preserves inherited variables and respects CPU and memory limits', () => {
    const sourceEnvironment = {
        PATH: 'existing-path',
        GOMAXPROCS: '1',
        GOMEMLIMIT: 'off',
        RAYON_NUM_THREADS: '3',
    };
    const result = getBuildEnvironment(sourceEnvironment, {
        availableParallelism: 16,
        totalMemoryBytes: 4 * DEFAULT_MEMORY_PER_WORKER_BYTES,
    });

    assert.deepEqual(result, {
        PATH: 'existing-path',
        GOMAXPROCS: '1',
        GOMEMLIMIT: 'off',
        RAYON_NUM_THREADS: '3',
    });
    assert.deepEqual(sourceEnvironment, {
        PATH: 'existing-path',
        GOMAXPROCS: '1',
        GOMEMLIMIT: 'off',
        RAYON_NUM_THREADS: '3',
    });
});

test('build environment caps Go and Rayon workers and bounds the Go memory limit', () => {
    const largeHost = getBuildEnvironment(
        {},
        {
            availableParallelism: 32,
            totalMemoryBytes: 64 * 1024 * 1024 * 1024,
        },
    );
    assert.equal(largeHost.GOMAXPROCS, '2');
    assert.equal(largeHost.GOMEMLIMIT, '2048MiB');
    assert.equal(largeHost.RAYON_NUM_THREADS, String(DEFAULT_MAX_WORKERS));

    const smallHost = getBuildEnvironment(
        {},
        {
            availableParallelism: 4,
            totalMemoryBytes: 1024 * 1024 * 1024,
        },
    );
    assert.equal(smallHost.GOMAXPROCS, '1');
    assert.equal(smallHost.GOMEMLIMIT, '512MiB');
    assert.equal(smallHost.RAYON_NUM_THREADS, '1');
});

test('build environment clamps oversized Go and Rayon settings to the calculated limit', () => {
    const result = getBuildEnvironment(
        { GOMAXPROCS: '6', RAYON_NUM_THREADS: '20' },
        {
            availableParallelism: 4,
            totalMemoryBytes: 2 * DEFAULT_MEMORY_PER_WORKER_BYTES,
        },
    );

    assert.equal(result.GOMAXPROCS, '2');
    assert.equal(result.RAYON_NUM_THREADS, '2');
});
