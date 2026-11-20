import { execFile as nodeExecFile } from 'node:child_process';
import { readFile as nodeReadFile } from 'node:fs/promises';

export interface StreamProcessResource {
    pid: number;
    workingSetBytes: number | null;
    privateBytes: number | null;
}

export interface StreamResourceSample {
    timestamp: number;
    totalRamBytes: number | null;
    availableRamBytes: number | null;
    committedBytes: number | null;
    commitLimitBytes: number | null;
    processes: StreamProcessResource[];
    samplingError: string | null;
}

export interface StreamResourceSamplerHandle {
    snapshot(): StreamResourceSample[];
    dispose(): void;
}

type Collector = (pids: number[]) => Promise<Partial<StreamResourceSample>>;

export interface StreamResourceSamplerOptions {
    collect?: Collector;
    now?: () => number;
    setInterval?: (callback: () => void, delay: number) => ReturnType<typeof globalThis.setInterval>;
    clearInterval?: (timer: ReturnType<typeof globalThis.setInterval>) => void;
}

interface Subscriber {
    getPids: () => number[];
}

const SAMPLE_INTERVAL_MS = 5000;
const MAX_SAMPLES = 12;

const emptySample = (timestamp: number, samplingError: string): StreamResourceSample => ({
    timestamp,
    totalRamBytes: null,
    availableRamBytes: null,
    committedBytes: null,
    commitLimitBytes: null,
    processes: [],
    samplingError,
});

function validPids(values: number[]): number[] {
    return [...new Set(values.filter(pid => Number.isSafeInteger(pid) && pid > 0))];
}

/** Shares one bounded, in-memory resource history among active stream sessions. */
export class StreamResourceSampler {
    private readonly collect: Collector;
    private readonly now: () => number;
    private readonly startInterval: NonNullable<StreamResourceSamplerOptions['setInterval']>;
    private readonly stopInterval: NonNullable<StreamResourceSamplerOptions['clearInterval']>;
    private readonly subscribers = new Map<number, Subscriber>();
    private readonly samples: StreamResourceSample[] = [];
    private nextSubscriberId = 1;
    private timer: ReturnType<typeof globalThis.setInterval> | null = null;
    private generation = 0;
    private collecting = false;
    private immediatePending = false;

    constructor(options: StreamResourceSamplerOptions = {}) {
        this.collect = options.collect ?? createSystemCollector();
        this.now = options.now ?? Date.now;
        this.startInterval = options.setInterval ?? globalThis.setInterval;
        this.stopInterval = options.clearInterval ?? globalThis.clearInterval;
    }

    public subscribe(getPids: () => number[]): StreamResourceSamplerHandle {
        const first = this.subscribers.size === 0;
        const id = this.nextSubscriberId++;
        this.subscribers.set(id, { getPids });
        if (this.timer === null) {
            this.timer = this.startInterval(() => this.requestSample(), SAMPLE_INTERVAL_MS);
            if (typeof this.timer === 'object' && this.timer !== null && 'unref' in this.timer) {
                (this.timer as NodeJS.Timeout).unref?.();
            }
        }
        if (first) this.requestSample(true);

        let disposed = false;
        return {
            snapshot: () =>
                this.samples.map(sample => ({
                    ...sample,
                    processes: sample.processes.map(process => ({ ...process })),
                })),
            dispose: () => {
                if (disposed) return;
                disposed = true;
                this.subscribers.delete(id);
                if (this.subscribers.size === 0) {
                    this.generation++;
                    this.samples.length = 0;
                    this.immediatePending = false;
                    if (this.timer !== null) {
                        this.stopInterval(this.timer);
                        this.timer = null;
                    }
                }
            },
        };
    }

    private requestSample(immediate = false): void {
        if (this.subscribers.size === 0) return;
        if (this.collecting) {
            if (immediate) this.immediatePending = true;
            return;
        }
        this.collecting = true;
        const generation = this.generation;
        const pids = validPids(
            [...this.subscribers.values()].flatMap(subscriber => {
                try {
                    const result = subscriber.getPids();
                    return Array.isArray(result) ? result : [];
                } catch {
                    return [];
                }
            }),
        );

        void Promise.resolve()
            .then(() => this.collect(pids))
            .then(result => {
                if (generation !== this.generation || this.subscribers.size === 0) return;
                const sample: StreamResourceSample = {
                    timestamp: this.now(),
                    totalRamBytes: finiteOrNull(result.totalRamBytes),
                    availableRamBytes: finiteOrNull(result.availableRamBytes),
                    committedBytes: finiteOrNull(result.committedBytes),
                    commitLimitBytes: finiteOrNull(result.commitLimitBytes),
                    processes: Array.isArray(result.processes)
                        ? result.processes
                              .filter(process => Number.isSafeInteger(process.pid) && process.pid > 0)
                              .map(process => ({
                                  pid: process.pid,
                                  workingSetBytes: finiteOrNull(process.workingSetBytes),
                                  privateBytes: finiteOrNull(process.privateBytes),
                              }))
                        : [],
                    samplingError: typeof result.samplingError === 'string' ? result.samplingError : null,
                };
                this.samples.push(sample);
                if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
            })
            .catch(() => {
                if (generation === this.generation && this.subscribers.size > 0) {
                    this.samples.push(emptySample(this.now(), 'sampling-failed'));
                    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
                }
            })
            .finally(() => {
                this.collecting = false;
                if (this.subscribers.size > 0 && this.immediatePending) {
                    this.immediatePending = false;
                    this.requestSample();
                }
            });
    }
}

function finiteOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

interface SystemCollectorIO {
    platform?: NodeJS.Platform;
    readFile?: (path: string) => Promise<string>;
    execPowerShell?: (command: string) => Promise<string>;
}

export function createSystemCollector(io: SystemCollectorIO = {}): Collector {
    const platform = io.platform ?? process.platform;
    const readFile = io.readFile ?? (path => nodeReadFile(path, 'utf8'));
    const execPowerShell =
        io.execPowerShell ??
        (command =>
            new Promise((resolve, reject) => {
                nodeExecFile(
                    'powershell.exe',
                    ['-NoProfile', '-NonInteractive', '-Command', command],
                    {
                        timeout: 3000,
                        maxBuffer: 128 * 1024,
                        windowsHide: true,
                    },
                    (error, stdout) => (error ? reject(error) : resolve(stdout)),
                );
            }));

    return async pids => {
        if (platform === 'win32') {
            try {
                const output = await execPowerShell(buildPowerShellCommand(validPids(pids)));
                return parseWindowsSample(output);
            } catch {
                return { samplingError: 'windows-sampling-failed' };
            }
        }
        if (platform === 'linux') {
            return collectLinuxSample(validPids(pids), readFile);
        }
        return { samplingError: 'platform-unsupported' };
    };
}

function buildPowerShellCommand(pids: number[]): string {
    const seed = pids.join(',');
    return `$ErrorActionPreference='Stop'; $seed=@(${seed}); $all=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId); $ids=[System.Collections.Generic.HashSet[int]]::new(); foreach($p in $seed){[void]$ids.Add([int]$p)}; do{$changed=$false; foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)){$changed=$true}}}while($changed); $target=@($ids | ForEach-Object {[int]$_}); $memory=Get-CimInstance Win32_PerfRawData_PerfOS_Memory -Property AvailableBytes,CommittedBytes,CommitLimit; $computer=Get-CimInstance Win32_ComputerSystem -Property TotalPhysicalMemory; if($target.Count -gt 0){$proc=@(Get-Process -Id $target -ErrorAction SilentlyContinue | ForEach-Object {[pscustomobject]@{pid=[int]$_.Id;workingSetBytes=[long]$_.WorkingSet64;privateBytes=[long]$_.PrivateMemorySize64}})}else{$proc=@()}; [pscustomobject]@{totalRamBytes=[long]$computer.TotalPhysicalMemory;availableRamBytes=[long]$memory.AvailableBytes;committedBytes=[long]$memory.CommittedBytes;commitLimitBytes=[long]$memory.CommitLimit;processes=$proc} | ConvertTo-Json -Compress -Depth 4`;
}

function parseWindowsSample(output: string): Partial<StreamResourceSample> {
    try {
        const value = JSON.parse(output) as Record<string, unknown>;
        const processValues = Array.isArray(value.processes)
            ? value.processes
            : value.processes && typeof value.processes === 'object'
              ? [value.processes]
              : [];
        return {
            totalRamBytes: numberOrNull(value.totalRamBytes),
            availableRamBytes: numberOrNull(value.availableRamBytes),
            committedBytes: numberOrNull(value.committedBytes),
            commitLimitBytes: numberOrNull(value.commitLimitBytes),
            processes: processValues.map((entry: Record<string, unknown>) => ({
                pid: Number(entry.pid),
                workingSetBytes: numberOrNull(entry.workingSetBytes),
                privateBytes: numberOrNull(entry.privateBytes),
            })),
        };
    } catch {
        return { samplingError: 'windows-response-invalid' };
    }
}

function numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

async function collectLinuxSample(
    pids: number[],
    readFile: (path: string) => Promise<string>,
): Promise<Partial<StreamResourceSample>> {
    let totalRamBytes: number | null = null;
    let availableRamBytes: number | null = null;
    let committedBytes: number | null = null;
    let commitLimitBytes: number | null = null;
    let failed = false;
    try {
        const meminfo = await readFile('/proc/meminfo');
        const values = new Map(
            [...meminfo.matchAll(/^([A-Za-z_]+):\s+(\d+)\s+kB$/gm)].map(match => [match[1], Number(match[2]) * 1024]),
        );
        totalRamBytes = values.get('MemTotal') ?? null;
        availableRamBytes = values.get('MemAvailable') ?? null;
        committedBytes = values.get('Committed_AS') ?? null;
        commitLimitBytes = values.get('CommitLimit') ?? null;
    } catch {
        failed = true;
    }

    const descendants = new Set<number>();
    const queue = [...pids];
    while (queue.length > 0) {
        const pid = queue.shift()!;
        if (descendants.has(pid)) continue;
        descendants.add(pid);
        try {
            const children = await readFile(`/proc/${pid}/task/${pid}/children`);
            for (const match of children.matchAll(/\d+/g)) queue.push(Number(match[0]));
        } catch {
            // A process may exit between PID collection and inspection.
        }
    }

    const processes: StreamProcessResource[] = [];
    for (const pid of descendants) {
        try {
            await readFile(`/proc/${pid}/statm`);
            const status = await readFile(`/proc/${pid}/status`);
            const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
            processes.push({
                pid,
                workingSetBytes: rssMatch ? Number(rssMatch[1]) * 1024 : null,
                privateBytes: null,
            });
        } catch {
            // A process may exit while sampled; omit it without failing the rest.
        }
    }
    return {
        totalRamBytes,
        availableRamBytes,
        committedBytes,
        commitLimitBytes,
        processes,
        ...(failed ? { samplingError: 'linux-memory-read-failed' } : {}),
    };
}

/** Module-wide sampler used by playback sessions that need shared resource history. */
export const streamResourceSampler = new StreamResourceSampler();
