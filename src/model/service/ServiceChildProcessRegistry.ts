import { ChildProcess, execFile } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';
import { isProcessGroupAlive } from '../../util/ManagedProcess.js';

interface OwnedProcess {
    pid: number;
    pgid?: number;
    identity: string | null;
    ended: boolean;
}

const execute = promisify(execFile);

/** Keeps ownership until a failed service's external processes have actually stopped. */
export class ServiceChildProcessRegistry {
    private readonly entries = new Map<number, OwnedProcess>();
    private readonly identityRequests = new Set<Promise<void>>();
    private cleanupPromise: Promise<void> | null = null;

    public constructor(private readonly child: ChildProcess) {
        child.on('message', this.onMessage);
    }

    private readonly onMessage = (raw: unknown): void => {
        if (typeof raw !== 'object' || raw === null) return;
        const message = raw as { type?: string; pid?: number; pgid?: number };
        const pid = message.pid;
        if (
            !Number.isSafeInteger(pid) ||
            pid! <= 0 ||
            pid! > 0x7fffffff ||
            pid === process.pid ||
            pid === this.child.pid
        )
            return;
        if (message.type === 'serviceProcessEnded') {
            const entry = this.entries.get(pid!);
            if (entry !== undefined) {
                entry.ended = true;
                // Most short probes are already gone. Do not accumulate completed PIDs forever.
                if ((entry.pgid === undefined ? isPidAlive(entry.pid) : isProcessGroupAlive(entry.pgid)) === false)
                    this.entries.delete(entry.pid);
            }
            return;
        }
        if (message.type !== 'serviceProcessStarted') return;
        if (process.platform !== 'win32' && message.pgid !== pid) return;
        const entry: OwnedProcess = { pid: pid!, pgid: message.pgid, identity: null, ended: false };
        this.entries.set(pid!, entry);
        const request = getProcessIdentity(pid!).then(identity => {
            entry.identity = identity;
        });
        this.identityRequests.add(request);
        void request.finally(() => this.identityRequests.delete(request));
    };

    public stopOwnedProcesses(): Promise<void> {
        if (this.cleanupPromise !== null) return this.cleanupPromise;
        this.cleanupPromise = this.cleanup().catch(error => {
            this.cleanupPromise = null;
            throw error;
        });
        return this.cleanupPromise;
    }

    private async cleanup(): Promise<void> {
        // Drain messages sent immediately before the service exit.
        await new Promise(resolve => setTimeout(resolve, 50));
        await Promise.all(this.identityRequests);
        this.child.removeListener('message', this.onMessage);
        for (const [pid, entry] of this.entries) {
            await this.stop(entry);
            this.entries.delete(pid);
        }
    }

    private async stop(entry: OwnedProcess): Promise<void> {
        const groupAlive = entry.pgid === undefined ? isPidAlive(entry.pid) : isProcessGroupAlive(entry.pgid);
        if (!groupAlive) return;
        const currentIdentity = await getProcessIdentity(entry.pid);
        // A reused PID must never be mistaken for one of our encoders.
        if (
            entry.identity === null ||
            (currentIdentity !== null && currentIdentity !== entry.identity) ||
            (currentIdentity === null && isPidAlive(entry.pid))
        ) {
            throw new Error(`ServiceProcessIdentityUnconfirmed: ${entry.pid}`);
        }
        if (process.platform === 'win32') {
            await execute('taskkill', ['/PID', String(entry.pid), '/T', '/F'], { windowsHide: true }).catch(error => {
                if (isPidAlive(entry.pid)) throw error;
            });
        } else {
            try {
                process.kill(-entry.pgid!, 'SIGKILL');
            } catch (error: any) {
                if (error.code !== 'ESRCH') throw error;
            }
        }
        const deadline = performance.now() + 5000;
        while (entry.pgid === undefined ? isPidAlive(entry.pid) : isProcessGroupAlive(entry.pgid)) {
            if (performance.now() >= deadline) throw new Error(`ServiceProcessStopUnconfirmed: ${entry.pid}`);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: any) {
        return error.code !== 'ESRCH';
    }
}

async function getProcessIdentity(pid: number): Promise<string | null> {
    try {
        if (process.platform === 'linux') {
            const stat = await fs.promises.readFile(`/proc/${pid}/stat`, 'utf8');
            return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
        }
        if (process.platform === 'win32') {
            const result = await execute(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
                ],
                { windowsHide: true, timeout: 3000 },
            );
            return result.stdout.trim() || null;
        }
        const result = await execute('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 3000 });
        return result.stdout.trim() || null;
    } catch {
        return null;
    }
}
