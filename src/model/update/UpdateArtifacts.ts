import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const outputs = ['dist', 'client/dist'] as const;
async function validate(root: string): Promise<void> {
    for (const entry of ['dist/index.js', 'client/dist/index.html']) {
        if (!(await fs.stat(path.join(root, entry))).isFile()) throw new Error(`更新成果物が不正です: ${entry}`);
    }
}

export async function captureUpdateArtifacts(root: string, snapshot: string): Promise<void> {
    await validate(root);
    for (const output of outputs)
        await fs.cp(path.join(root, output), path.join(snapshot, output), { recursive: true });
    await validate(snapshot);
}

/** Restore saved executable/UI output without invoking the compiler that just failed. */
export async function restoreUpdateArtifacts(root: string, snapshot: string): Promise<void> {
    await validate(snapshot);
    const token = randomUUID();
    const staged: Array<{
        destination: string;
        incoming: string;
        previous: string;
        hadPrevious: boolean;
        installed: boolean;
    }> = [];
    try {
        for (const output of outputs) {
            const destination = path.join(root, output);
            const incoming = `${destination}.restore-${token}`;
            const previous = `${destination}.failed-${token}`;
            staged.push({ destination, incoming, previous, hadPrevious: false, installed: false });
            await fs.cp(path.join(snapshot, output), incoming, { recursive: true });
        }
        for (const stage of staged) {
            try {
                await fs.rename(stage.destination, stage.previous);
                stage.hadPrevious = true;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
            await fs.rename(stage.incoming, stage.destination);
            stage.installed = true;
        }
    } catch (error) {
        for (const stage of [...staged].reverse()) {
            if (stage.installed) await fs.rm(stage.destination, { recursive: true, force: true });
            if (stage.hadPrevious) await fs.rename(stage.previous, stage.destination);
        }
        throw error;
    } finally {
        for (const stage of staged) await fs.rm(stage.incoming, { recursive: true, force: true });
    }
    for (const stage of staged) await fs.rm(stage.previous, { recursive: true, force: true });
}
