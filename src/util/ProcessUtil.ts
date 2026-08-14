import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

namespace ProcessUtil {
    /**
     * セットしたプロセスを前処理をしてから殺す
     * @param child: ChildProcess
     * @param wait: number default 500
     */
    const waitForExit = (child: ChildProcess, timeout: number): Promise<boolean> => {
        if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
        return new Promise(resolve => {
            const timer = setTimeout(() => finish(false), timeout);
            const onExit = (): void => finish(true);
            const finish = (exited: boolean): void => {
                clearTimeout(timer);
                child.removeListener('exit', onExit);
                resolve(exited);
            };
            child.once('exit', onExit);
        });
    };

    const forceKillTree = async (child: ChildProcess): Promise<void> => {
        if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
        if (process.platform === 'win32') {
            await new Promise<void>(resolve => {
                const killer = spawn('taskkill', ['/pid', child.pid!.toString(10), '/T', '/F'], {
                    windowsHide: true,
                });
                killer.once('error', () => resolve());
                killer.once('exit', () => resolve());
            });
        } else {
            try {
                child.kill('SIGKILL');
            } catch {
                // It may have exited between the state check and kill().
            }
        }
    };

    export const kill = async (child: ChildProcess, wait = 500): Promise<void> => {
        if (child.stdin !== null) {
            child.stdin.end();
        }
        if (child.stdout !== null) {
            child.stdout.unpipe();
            child.stdout.destroy();
            child.stdout.removeAllListeners('data');
        }
        if (child.stderr !== null) {
            child.stderr.unpipe();
            child.stderr.destroy();
            child.stderr.removeAllListeners('data');
        }

        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        if (child.exitCode !== null || child.signalCode !== null) return;
        try {
            child.kill('SIGINT');
        } catch {
            // Continue to the exit check and tree kill fallback.
        }
        if (await waitForExit(child, 2_000)) return;
        await forceKillTree(child);
        await waitForExit(child, 2_000);
    };

    export interface Cmds {
        bin: string;
        args: string[];
    }

    export const ROOT_PATH = path.join(__dirname, '..', '..').replace(new RegExp(`\\${path.sep}$`), '');

    /**
     * 渡された cmd 文字列を bin と args に分離する
     * @param cmd: string
     * @return ProcessUtil.Cmds
     */
    export const parseCmdStr = (cmd: string): ProcessUtil.Cmds => {
        let args = cmd.split(' ');
        let bin = args.shift();
        if (typeof bin === 'undefined') {
            throw new Error('CmdParseError');
        }

        // %NODE% の replace
        bin = bin.replace(/%NODE%/g, process.argv[0]);

        // bin の存在確認
        try {
            fs.statSync(bin);
        } catch (e: any) {
            throw new Error('CmdBinIsNotFound');
        }

        args = args
            .map(arg => {
                // 引数内の %ROOT% を置換
                return arg.replace(/%ROOT%/g, ROOT_PATH);
            })
            .map(arg => {
                // 引数内の %SPACE% を半角スペースに置換
                return arg.replace(/%SPACE%/g, ' ');
            });

        return {
            bin: bin,
            args: args.filter(arg => {
                return arg.length > 0;
            }),
        };
    };

    /**
     * プロセスが終了しているか
     * @param child ChildProcess
     * @return boolean 終了していれば true を返す
     */
    export const isExited = (child: ChildProcess): boolean => {
        return child.exitCode !== null;
    };
}

export default ProcessUtil;
