'use strict';

const os = require('node:os');

const DEFAULT_MAX_WORKERS = 8;
const DEFAULT_MEMORY_PER_WORKER_BYTES = 1536 * 1024 * 1024;
const MEBIBYTE_BYTES = 1024 * 1024;
const MIN_GO_MEMORY_LIMIT_MIB = 512;
const MAX_GO_MEMORY_LIMIT_MIB = 2048;

function positiveInteger(value, fallback, name) {
    if (!Number.isSafeInteger(value) || value < 1) {
        if (fallback !== undefined) {
            return fallback;
        }

        throw new TypeError(`${name} must be a positive safe integer.`);
    }

    return value;
}

function getWorkerLimit({
    availableParallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length,
    totalMemoryBytes = os.totalmem(),
    maxWorkers = DEFAULT_MAX_WORKERS,
    memoryPerWorkerBytes = DEFAULT_MEMORY_PER_WORKER_BYTES,
} = {}) {
    const cpuCount = positiveInteger(availableParallelism, 1, 'availableParallelism');
    const memoryBytes = positiveInteger(totalMemoryBytes, 1, 'totalMemoryBytes');
    const workerCap = positiveInteger(maxWorkers, DEFAULT_MAX_WORKERS, 'maxWorkers');
    const workerMemoryBytes = positiveInteger(
        memoryPerWorkerBytes,
        DEFAULT_MEMORY_PER_WORKER_BYTES,
        'memoryPerWorkerBytes',
    );
    const memoryWorkers = Math.max(1, Math.floor(memoryBytes / workerMemoryBytes));

    return Math.max(1, Math.min(cpuCount, memoryWorkers, workerCap));
}

function getResourcePlan(options) {
    const availableParallelism =
        options?.availableParallelism ??
        (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length);
    const totalMemoryBytes = options?.totalMemoryBytes ?? os.totalmem();

    return {
        availableParallelism: positiveInteger(availableParallelism, 1, 'availableParallelism'),
        totalMemoryBytes: positiveInteger(totalMemoryBytes, 1, 'totalMemoryBytes'),
        maxWorkers: getWorkerLimit({ ...options, availableParallelism, totalMemoryBytes }),
    };
}

function parsePositiveInteger(value) {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function getBuildEnvironment(environment = process.env, options) {
    const env = { ...environment };
    const plan = getResourcePlan(options);
    const defaultGoProcs = Math.min(plan.maxWorkers, 2);
    const configuredGoProcs = parsePositiveInteger(env.GOMAXPROCS);
    const configuredRayonThreads = parsePositiveInteger(env.RAYON_NUM_THREADS);
    const memoryLimitMiB = Math.max(
        MIN_GO_MEMORY_LIMIT_MIB,
        Math.min(MAX_GO_MEMORY_LIMIT_MIB, Math.floor(plan.totalMemoryBytes / 4 / MEBIBYTE_BYTES)),
    );

    env.GOMAXPROCS = String(Math.min(defaultGoProcs, configuredGoProcs ?? defaultGoProcs));
    if (typeof env.GOMEMLIMIT !== 'string' || env.GOMEMLIMIT.length === 0) {
        env.GOMEMLIMIT = `${String(memoryLimitMiB)}MiB`;
    }
    env.RAYON_NUM_THREADS = String(Math.min(plan.maxWorkers, configuredRayonThreads ?? plan.maxWorkers));

    return env;
}

module.exports = {
    DEFAULT_MAX_WORKERS,
    DEFAULT_MEMORY_PER_WORKER_BYTES,
    getBuildEnvironment,
    getResourcePlan,
    getWorkerLimit,
};
