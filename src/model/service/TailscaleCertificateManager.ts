import { spawn } from 'child_process';
import { X509Certificate } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as tls from 'tls';
import { TailscaleHttpsConfig } from '../IConfigFile';
import ILogger from '../ILogger';

export interface TailscaleCertificate {
    cert: Buffer;
    key: Buffer;
    hostname: string;
    validTo: Date;
}

const DEFAULT_RENEW_BEFORE_DAYS = 30;
const DEFAULT_CHECK_INTERVAL_HOURS = 24;
const RETRY_INTERVAL_MILLISECONDS = 5 * 60 * 1000;
const COMMAND_TIMEOUT_MILLISECONDS = 60 * 1000;

class TailscaleCertificateManager {
    private readonly config: TailscaleHttpsConfig;
    private readonly log: ILogger;
    private readonly rootPath: string;
    private readonly certificateDirectory: string;
    private readonly certificatePath: string;
    private readonly keyPath: string;
    private readonly renewBeforeMilliseconds: number;
    private readonly checkIntervalMilliseconds: number;
    private refreshPromise: Promise<TailscaleCertificate | null> | null = null;
    private timer: NodeJS.Timeout | null = null;
    private hostname: string | null = null;
    private hasUsableCertificate = false;

    constructor(config: TailscaleHttpsConfig, log: ILogger, rootPath: string) {
        this.config = config;
        this.log = log;
        this.rootPath = rootPath;
        this.certificateDirectory =
            config.certificateDirectory === undefined
                ? path.join(rootPath, 'data', 'tls', 'tailscale')
                : config.certificateDirectory.replace(/%ROOT%/g, rootPath);
        this.certificatePath = path.join(this.certificateDirectory, 'certificate.pem');
        this.keyPath = path.join(this.certificateDirectory, 'private-key.pem');
        this.renewBeforeMilliseconds = (config.renewBeforeDays ?? DEFAULT_RENEW_BEFORE_DAYS) * 24 * 60 * 60 * 1000;
        this.checkIntervalMilliseconds = (config.checkIntervalHours ?? DEFAULT_CHECK_INTERVAL_HOURS) * 60 * 60 * 1000;
    }

    public async initialize(): Promise<TailscaleCertificate> {
        await fs.promises.mkdir(this.certificateDirectory, { recursive: true, mode: 0o700 });
        this.hostname = await this.resolveHostname();

        const existing = await this.readStoredCertificate(this.hostname);
        if (existing !== null && this.hasEnoughValidity(existing)) {
            this.hasUsableCertificate = true;
            this.log.system.info(
                `Tailscale HTTPS certificate loaded for ${existing.hostname}, valid until ${existing.validTo.toISOString()}`,
            );
            return existing;
        }

        try {
            const acquired = await this.acquireCertificate(this.hostname);
            this.hasUsableCertificate = true;
            return acquired;
        } catch (err: any) {
            if (existing !== null && existing.validTo.getTime() > Date.now()) {
                this.hasUsableCertificate = true;
                this.log.system.warn(
                    'Tailscale HTTPS certificate renewal failed; continuing with the current certificate',
                );
                this.log.system.warn(err);
                return existing;
            }
            throw err;
        }
    }

    public start(onUpdate: (certificate: TailscaleCertificate) => void): void {
        if (this.timer !== null) {
            return;
        }

        const schedule = (delay: number): void => {
            this.timer = setTimeout(() => {
                void this.refresh()
                    .then(certificate => {
                        if (certificate !== null) {
                            this.hasUsableCertificate = true;
                            onUpdate(certificate);
                        }
                        schedule(this.checkIntervalMilliseconds);
                    })
                    .catch((err: any) => {
                        this.log.system.warn('Tailscale HTTPS certificate update check failed');
                        this.log.system.warn(err);
                        schedule(RETRY_INTERVAL_MILLISECONDS);
                    });
            }, delay);
            this.timer.unref();
        };
        schedule(this.hasUsableCertificate ? this.checkIntervalMilliseconds : RETRY_INTERVAL_MILLISECONDS);
    }

    public stop(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private async refresh(): Promise<TailscaleCertificate | null> {
        if (this.refreshPromise !== null) {
            return this.refreshPromise;
        }

        this.refreshPromise = this.refreshInternal();
        try {
            return await this.refreshPromise;
        } finally {
            this.refreshPromise = null;
        }
    }

    private async refreshInternal(): Promise<TailscaleCertificate | null> {
        const hostname = this.hostname ?? (await this.resolveHostname());
        this.hostname = hostname;
        const existing = await this.readStoredCertificate(hostname);
        if (existing !== null && this.hasEnoughValidity(existing)) {
            return null;
        }

        try {
            return await this.acquireCertificate(hostname);
        } catch (err: any) {
            if (existing !== null && existing.validTo.getTime() > Date.now()) {
                this.log.system.warn(
                    'Tailscale HTTPS certificate renewal failed; continuing with the current certificate',
                );
                this.log.system.warn(err);
                return null;
            }
            throw err;
        }
    }

    private hasEnoughValidity(certificate: TailscaleCertificate): boolean {
        return certificate.validTo.getTime() - Date.now() > this.renewBeforeMilliseconds;
    }

    private async readStoredCertificate(hostname: string): Promise<TailscaleCertificate | null> {
        try {
            const [cert, key] = await Promise.all([
                fs.promises.readFile(this.certificatePath),
                fs.promises.readFile(this.keyPath),
            ]);
            return this.validateCertificate(cert, key, hostname);
        } catch (err: any) {
            if (err?.code !== 'ENOENT') {
                this.log.system.warn('Stored Tailscale HTTPS certificate is unavailable or invalid');
                this.log.system.warn(err);
            }
            return null;
        }
    }

    private async acquireCertificate(hostname: string): Promise<TailscaleCertificate> {
        const suffix = `${process.pid.toString(10)}-${Date.now().toString(10)}`;
        const temporaryCertificatePath = path.join(this.certificateDirectory, `certificate-${suffix}.tmp`);
        const temporaryKeyPath = path.join(this.certificateDirectory, `private-key-${suffix}.tmp`);

        try {
            const minimumValidityHours = Math.max(1, Math.floor(this.renewBeforeMilliseconds / (60 * 60 * 1000)));
            await this.runTailscale([
                'cert',
                `--cert-file=${temporaryCertificatePath}`,
                `--key-file=${temporaryKeyPath}`,
                `--min-validity=${minimumValidityHours.toString(10)}h`,
                hostname,
            ]);

            const [cert, key] = await Promise.all([
                fs.promises.readFile(temporaryCertificatePath),
                fs.promises.readFile(temporaryKeyPath),
            ]);
            const certificate = this.validateCertificate(cert, key, hostname);
            await this.replaceCertificateFiles(temporaryCertificatePath, temporaryKeyPath);
            this.log.system.info(
                `Tailscale HTTPS certificate acquired for ${hostname}, valid until ${certificate.validTo.toISOString()}`,
            );
            return certificate;
        } finally {
            await Promise.all([
                fs.promises.rm(temporaryCertificatePath, { force: true }),
                fs.promises.rm(temporaryKeyPath, { force: true }),
            ]);
        }
    }

    private validateCertificate(cert: Buffer, key: Buffer, hostname: string): TailscaleCertificate {
        const certificate = new X509Certificate(cert);
        const hostError = certificate.checkHost(hostname);
        if (hostError === undefined) {
            throw new Error(`Tailscale certificate is not valid for ${hostname}`);
        }

        const validTo = new Date(certificate.validTo);
        if (Number.isFinite(validTo.getTime()) === false || validTo.getTime() <= Date.now()) {
            throw new Error('Tailscale certificate has expired');
        }

        tls.createSecureContext({ cert, key });
        return { cert, key, hostname, validTo };
    }

    private async replaceCertificateFiles(temporaryCertificatePath: string, temporaryKeyPath: string): Promise<void> {
        await this.replaceFile(temporaryCertificatePath, this.certificatePath, 0o644);
        await this.replaceFile(temporaryKeyPath, this.keyPath, 0o600);
    }

    private async replaceFile(source: string, destination: string, mode: number): Promise<void> {
        try {
            await fs.promises.rename(source, destination);
        } catch (err: any) {
            if (err?.code !== 'EEXIST' && err?.code !== 'EPERM') {
                throw err;
            }
            await fs.promises.rm(destination, { force: true });
            await fs.promises.rename(source, destination);
        }
        if (process.platform !== 'win32') {
            await fs.promises.chmod(destination, mode);
        }
    }

    private async resolveHostname(): Promise<string> {
        const configured = this.normalizeHostname(this.config.hostname);
        if (configured !== null) {
            return configured;
        }

        const output = await this.runTailscale(['status', '--json']);
        let parsed: unknown;
        try {
            parsed = JSON.parse(output);
        } catch {
            throw new Error('Failed to parse "tailscale status --json" output');
        }

        const dnsName =
            typeof parsed === 'object' &&
            parsed !== null &&
            'Self' in parsed &&
            typeof parsed.Self === 'object' &&
            parsed.Self !== null &&
            'DNSName' in parsed.Self &&
            typeof parsed.Self.DNSName === 'string'
                ? parsed.Self.DNSName
                : undefined;
        const hostname = this.normalizeHostname(dnsName);
        if (hostname === null) {
            throw new Error('Tailscale MagicDNS name was not found; enable MagicDNS and HTTPS certificates');
        }
        return hostname;
    }

    private normalizeHostname(value: string | undefined): string | null {
        if (value === undefined) {
            return null;
        }
        const hostname = value.trim().replace(/\.$/, '').toLowerCase();
        if (/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) === false || hostname.includes('.') === false) {
            throw new Error('Invalid Tailscale HTTPS hostname');
        }
        return hostname;
    }

    private runTailscale(args: string[]): Promise<string> {
        const executable = this.resolveTailscaleExecutable();
        return new Promise<string>((resolve, reject) => {
            const child = spawn(executable, args, {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            let settled = false;
            const finish = (err?: Error): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                if (err === undefined) {
                    resolve(stdout);
                } else {
                    reject(err);
                }
            };
            const timeout = setTimeout(() => {
                child.kill();
                finish(new Error(`tailscale ${args[0] ?? ''} timed out`));
            }, COMMAND_TIMEOUT_MILLISECONDS);

            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            child.stdout.on('data', chunk => {
                stdout += chunk;
            });
            child.stderr.on('data', chunk => {
                stderr += chunk;
            });
            child.once('error', err => {
                finish(err);
            });
            child.once('close', code => {
                if (code === 0) {
                    finish();
                } else {
                    finish(
                        new Error(
                            `tailscale ${args[0] ?? ''} failed with exit code ${String(code)}${
                                stderr.trim().length === 0 ? '' : `: ${stderr.trim()}`
                            }`,
                        ),
                    );
                }
            });
        });
    }

    private resolveTailscaleExecutable(): string {
        if (this.config.tailscalePath !== undefined && this.config.tailscalePath.trim().length > 0) {
            return this.config.tailscalePath.replace(/%ROOT%/g, this.rootPath);
        }

        if (process.platform === 'win32') {
            const programFiles = process.env.ProgramFiles;
            if (programFiles !== undefined) {
                const candidate = path.join(programFiles, 'Tailscale', 'tailscale.exe');
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        }
        return 'tailscale';
    }
}

export default TailscaleCertificateManager;
