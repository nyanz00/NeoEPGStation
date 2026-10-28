export interface ResourceOptions {
    availableParallelism?: number;
    totalMemoryBytes?: number;
    maxWorkers?: number;
    memoryPerWorkerBytes?: number;
}

export interface ResourcePlan {
    availableParallelism: number;
    totalMemoryBytes: number;
    maxWorkers: number;
}

export declare const DEFAULT_MAX_WORKERS: number;
export declare const DEFAULT_MEMORY_PER_WORKER_BYTES: number;
export declare function getWorkerLimit(options?: ResourceOptions): number;
export declare function getResourcePlan(options?: ResourceOptions): ResourcePlan;
export declare function getBuildEnvironment(
    environment?: NodeJS.ProcessEnv,
    options?: ResourceOptions,
): NodeJS.ProcessEnv;
