import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import ProcessUtil from './ProcessUtil';

interface ManagedChild {
    started: boolean;
}

interface ProcessWithIPC {
    send?: (...args: any[]) => boolean;
}

const ipcProcess = process as ProcessWithIPC;
const KILL_CONFIRM_INTERVAL_MS = 50;
const KILL_CONFIRM_TIMEOUT_MS = 2000;
const ownedChildren = new Map<childProcess.ChildProcess, ManagedChild>();
const stoppingChildren = new Set<childProcess.ChildProcess>();
let disconnectListenerAttached = false;
let cleanupRunning = false;

function sendServiceMessage(message: Record<string, unknown>): void {
    if (typeof ipcProcess.send !== 'function') {
        return;
    }

    try {
        ipcProcess.send(message, (error: Error | null) => {
            if (error != null) {
                cleanupOwnedChildren();
            }
        });
    } catch {
        cleanupOwnedChildren();
    }
}

function stopOwnedChild(child: childProcess.ChildProcess): void {
    if (stoppingChildren.has(child) === true) {
        return;
    }
    stoppingChildren.add(child);
    if (process.platform === 'win32') {
        void ProcessUtil.kill(child).catch(() => {});
        return;
    }
    if (child.pid === undefined) {
        return;
    }
    try {
        process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ESRCH') {
            // Best effort cleanup on disconnect; avoid an unhandled exception here.
        }
    }
}

function cleanupOwnedChildren(): void {
    if (cleanupRunning === true) {
        return;
    }
    cleanupRunning = true;
    try {
        for (const child of ownedChildren.keys()) {
            stopOwnedChild(child);
        }
    } finally {
        cleanupRunning = false;
    }
}

function onParentDisconnect(): void {
    cleanupOwnedChildren();
}

function attachDisconnectListener(): void {
    if (disconnectListenerAttached === false) {
        process.once('disconnect', onParentDisconnect);
        disconnectListenerAttached = true;
    }
}

function detachDisconnectListenerIfIdle(): void {
    if (ownedChildren.size === 0 && disconnectListenerAttached === true) {
        process.removeListener('disconnect', onParentDisconnect);
        disconnectListenerAttached = false;
    }
}

/** Spawn a child with an isolated POSIX process group and service ownership reporting. */
export const spawnManaged: typeof childProcess.spawn = ((...args: any[]) => {
    const optionsIndex = Array.isArray(args[1]) ? 2 : 1;
    const requestedOptions = args[optionsIndex] as childProcess.SpawnOptions | undefined;
    const options =
        process.platform === 'win32'
            ? { ...requestedOptions, windowsHide: requestedOptions?.windowsHide ?? true }
            : { ...requestedOptions, detached: true };
    args[optionsIndex] = options;

    const child = (childProcess.spawn as (...spawnArgs: any[]) => childProcess.ChildProcess)(...args);
    if (typeof ipcProcess.send !== 'function') {
        return child;
    }

    const state: ManagedChild = { started: false };
    ownedChildren.set(child, state);
    attachDisconnectListener();

    child.once('spawn', () => {
        state.started = true;
        if (typeof child.pid !== 'number') {
            return;
        }
        sendServiceMessage({
            type: 'serviceProcessStarted',
            kind: 'stream',
            pid: child.pid,
            pgid: process.platform === 'win32' ? undefined : child.pid,
        });
    });
    child.once('close', () => {
        ownedChildren.delete(child);
        stoppingChildren.delete(child);
        if (state.started === true && typeof child.pid === 'number') {
            sendServiceMessage({ type: 'serviceProcessEnded', pid: child.pid });
        }
        detachDisconnectListenerIfIdle();
    });

    return child;
}) as typeof childProcess.spawn;

/** Gracefully stop a child first, then force-stop any surviving POSIX process group. */
export async function killManaged(
    child: childProcess.ChildProcess,
    wait = 500,
    confirmTimeoutMs = KILL_CONFIRM_TIMEOUT_MS,
): Promise<void> {
    if (!Number.isFinite(confirmTimeoutMs) || confirmTimeoutMs < 0) {
        throw new RangeError('InvalidManagedProcessConfirmTimeout');
    }
    await ProcessUtil.kill(child, wait);
    const deadline = performance.now() + confirmTimeoutMs;

    if (process.platform === 'win32') {
        // ProcessUtil.kill uses taskkill /T /F on Windows. Windows exposes no portable
        // process-group query, so confirm the tree leader exits after that tree kill.
        await waitForStopConfirmation(() => isChildExited(child), deadline);
        return;
    }

    const pid = child.pid;
    if (typeof pid !== 'number') {
        await waitForStopConfirmation(() => isChildExited(child), deadline);
        return;
    }

    if (isProcessGroupAlive(pid) === true) {
        try {
            process.kill(-pid, 'SIGKILL');
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== 'ESRCH') {
                throw error;
            }
        }
    }

    await waitForStopConfirmation(() => isChildExited(child) && isProcessGroupAlive(pid) === false, deadline);
}

function isChildExited(child: childProcess.ChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null;
}

async function waitForStopConfirmation(isStopped: () => boolean, deadline: number): Promise<void> {
    while (isStopped() === false) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) {
            throw new Error('ManagedProcessStopTimeout');
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(KILL_CONFIRM_INTERVAL_MS, remaining)));
    }
}

export function isProcessGroupAlive(pid: number): boolean {
    try {
        process.kill(-pid, 0);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'ESRCH') {
            return false;
        }
        if (code === 'EPERM') {
            return true;
        }
        throw error;
    }

    if (process.platform === 'linux') {
        const procGroupState = getLinuxProcessGroupState(pid);
        if (procGroupState !== null) {
            return procGroupState;
        }
    }
    return true;
}

/** Returns null when /proc cannot be queried, otherwise whether runnable group members remain. */
function getLinuxProcessGroupState(pgid: number): boolean | null {
    let entries: string[];
    try {
        entries = fs.readdirSync('/proc');
    } catch {
        return null;
    }

    let unreadable = false;
    for (const entry of entries) {
        if (/^\d+$/.test(entry) === false) {
            continue;
        }
        let stat: string;
        try {
            stat = fs.readFileSync(path.join('/proc', entry, 'stat'), 'utf8');
        } catch (error) {
            const code = (error as NodeJS.ErrnoException)?.code;
            if (code === 'EACCES' || code === 'EPERM') {
                unreadable = true;
            }
            continue;
        }

        const commandEnd = stat.lastIndexOf(')');
        if (commandEnd < 0) {
            continue;
        }
        const fields = stat.slice(commandEnd + 2).split(' ');
        const state = fields[0];
        const processGroupId = Number(fields[2]);
        if (processGroupId === pgid && state !== 'Z' && state !== 'X') {
            return true;
        }
    }

    return unreadable === true ? null : false;
}
