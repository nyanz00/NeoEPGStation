import { execFile } from 'child_process';
import diskusage from 'diskusage-ng';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import * as apid from '../../../../api';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IVideoFileDB from '../../db/IVideoFileDB';
import IStorageApiModel from './IStorageApiModel';

interface CpuTimes {
    idle: number;
    total: number;
}

@injectable()
export default class StorageApiModel implements IStorageApiModel {
    private config: IConfigFile;
    private videoFileDB: IVideoFileDB;
    private previousCpuTimes: CpuTimes | null = null;
    private directorySizeCache: Map<string, { expiresAt: number; size: number }> = new Map();
    private directorySizePromises: Map<string, Promise<number>> = new Map();
    private gpuCache: { expiresAt: number; items: apid.SystemGpuInfo[] } | null = null;
    private storageVolumeCache: { expiresAt: number; items: apid.SystemStorageVolume[] } | null = null;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
    ) {
        this.config = configuration.getConfig();
        this.videoFileDB = videoFileDB;
    }

    /**
     * recorded のディスク情報を返す
     * @return Promise<apid.StorageInfo>
     */
    public async getInfo(): Promise<apid.StorageInfo> {
        const items: apid.StorageItem[] = [];
        const [sizeSummaries, dropLogSize, thumbnailSize, system] = await Promise.all([
            this.videoFileDB.getSizeSummaries(),
            this.getCachedDirectorySize(this.config.dropLog),
            this.getCachedDirectorySize(this.config.thumbnail),
            this.getSystemInfo(),
        ]);
        const sizeByDirectory = new Map(sizeSummaries.map(item => [item.parentDirectoryName, item.size]));
        const recordedSizeByVolume = new Map<string, number>();

        for (const recorded of this.config.recorded) {
            const volume = this.getVolumeKey(recorded.path);
            recordedSizeByVolume.set(
                volume,
                (recordedSizeByVolume.get(volume) ?? 0) + (sizeByDirectory.get(recorded.name) ?? 0),
            );
        }
        const dropLogVolume = this.getVolumeKey(this.config.dropLog);
        const thumbnailVolume = this.getVolumeKey(this.config.thumbnail);

        for (const r of this.config.recorded) {
            const info = await this.getDiskInfo(r.path);
            const volume = this.getVolumeKey(r.path);
            const recorded = recordedSizeByVolume.get(volume) ?? 0;
            const dropLogs = volume === dropLogVolume ? dropLogSize : 0;
            const thumbnails = volume === thumbnailVolume ? thumbnailSize : 0;
            items.push({
                ...info,
                name: r.name,
                breakdown: {
                    recorded,
                    dropLogs,
                    thumbnails,
                    other: Math.max(0, info.used - recorded - dropLogs - thumbnails),
                },
            });
        }

        return {
            items,
            system,
        };
    }

    public async getLog(
        source: apid.SystemLogSource,
        category: apid.SystemLogCategory,
        lineLimit: number,
    ): Promise<apid.SystemLogInfo> {
        const fileName = `${category}.log`;
        const logPath = path.join(this.getDefaultLogDirectory(), source, fileName);
        const limit = Math.min(2_000, Math.max(50, Math.floor(lineLimit)));
        let stat: fs.Stats;
        try {
            stat = await fs.promises.stat(logPath);
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                return {
                    source,
                    category,
                    fileName,
                    exists: false,
                    size: 0,
                    lines: [],
                    truncated: false,
                };
            }
            throw err;
        }

        const maxBytes = 2 * 1024 * 1024;
        const readSize = Math.min(stat.size, maxBytes);
        const handle = await fs.promises.open(logPath, 'r');
        try {
            const buffer = Buffer.alloc(readSize);
            await handle.read(buffer, 0, readSize, Math.max(0, stat.size - readSize));
            const allLines = buffer
                .toString('utf8')
                .replace(/^\uFFFD/, '')
                .split(/\r?\n/);
            if (allLines[allLines.length - 1] === '') allLines.pop();
            const lines = allLines.slice(-limit);
            return {
                source,
                category,
                fileName,
                exists: true,
                size: stat.size,
                updatedAt: stat.mtimeMs,
                lines,
                truncated: stat.size > readSize || allLines.length > lines.length,
            };
        } finally {
            await handle.close();
        }
    }

    public async getGpuInfo(): Promise<apid.SystemGpuList> {
        return {
            items: await this.getGpuItems(),
            sampledAt: Date.now(),
        };
    }

    public async getStorageVolumes(): Promise<apid.SystemStorageVolumeList> {
        const now = Date.now();
        if (this.storageVolumeCache !== null && this.storageVolumeCache.expiresAt > now) {
            return {
                items: this.storageVolumeCache.items,
                sampledAt: now,
            };
        }
        const allVolumes =
            process.platform === 'win32' ? await this.getWindowsStorageVolumes() : await this.getUnixStorageVolumes();
        const primaryVolumes = new Set(this.config.recorded.map(recorded => this.getVolumeKey(recorded.path)));
        const items = allVolumes.filter(volume => !primaryVolumes.has(this.getVolumeKey(volume.path)));
        this.storageVolumeCache = { expiresAt: now + 30_000, items };
        return {
            items,
            sampledAt: now,
        };
    }

    private async getSystemInfo(): Promise<apid.SystemResourceInfo> {
        const totalMemory = os.totalmem();
        const availableMemory = os.freemem();
        const usedMemory = Math.max(0, totalMemory - availableMemory);
        const cpu = await this.getCpuInfo();

        return {
            hostname: os.hostname(),
            platform: `${os.type()} ${os.release()}`,
            arch: os.arch(),
            uptime: os.uptime(),
            sampledAt: Date.now(),
            cpu,
            memory: {
                total: totalMemory,
                used: usedMemory,
                available: availableMemory,
                usagePercent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0,
            },
            process: {
                pid: process.pid,
                uptime: process.uptime(),
                memoryUsed: process.memoryUsage().rss,
            },
        };
    }

    private async getCpuInfo(): Promise<apid.SystemCpuInfo> {
        let current = this.readCpuTimes();
        let previous = this.previousCpuTimes;
        if (previous === null) {
            await new Promise(resolve => setTimeout(resolve, 150));
            previous = current;
            current = this.readCpuTimes();
        }
        this.previousCpuTimes = current;
        const totalDelta = Math.max(0, current.total - previous.total);
        const idleDelta = Math.max(0, current.idle - previous.idle);
        const usagePercent = totalDelta > 0 ? Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100)) : 0;
        const cpus = os.cpus();

        return {
            model: cpus[0]?.model.trim() ?? 'Unknown CPU',
            logicalCores: cpus.length,
            usagePercent,
        };
    }

    private readCpuTimes(): CpuTimes {
        return os.cpus().reduce(
            (result, cpu) => {
                result.idle += cpu.times.idle;
                result.total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
                return result;
            },
            { idle: 0, total: 0 },
        );
    }

    private async getGpuItems(): Promise<apid.SystemGpuInfo[]> {
        const now = Date.now();
        if (this.gpuCache !== null && this.gpuCache.expiresAt > now) return this.gpuCache.items;

        const [nvidiaItems, windowsItems] = await Promise.all([
            this.getNvidiaGpuInfo(),
            process.platform === 'win32' ? this.getWindowsGpuInfo() : Promise.resolve([]),
        ]);
        const items = this.mergeGpuInfo(nvidiaItems, windowsItems);
        this.gpuCache = { expiresAt: now + 10_000, items };
        return items;
    }

    private async getWindowsStorageVolumes(): Promise<apid.SystemStorageVolume[]> {
        const script =
            '$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);' +
            "$volumes=@(Get-CimInstance Win32_LogicalDisk -ErrorAction SilentlyContinue | Where-Object {$null -ne $_.Size -and $_.Size -gt 0 -and $_.DriveType -in 2,3,4} | ForEach-Object {$type=switch($_.DriveType){2{'removable'}3{'fixed'}4{'network'}default{'other'}};$label=if([string]::IsNullOrWhiteSpace($_.VolumeName)){$_.DeviceID}else{$_.DeviceID+' '+$_.VolumeName};[pscustomobject]@{id=$_.DeviceID;name=$label;path=$_.DeviceID+'\\';type=$type;available=[double]$_.FreeSpace;used=[double]($_.Size-$_.FreeSpace);total=[double]$_.Size}});" +
            '[pscustomobject]@{volumes=$volumes}|ConvertTo-Json -Depth 4 -Compress';
        try {
            const output = await this.runCommand('powershell.exe', [
                '-NoLogo',
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                script,
            ]);
            const parsed = JSON.parse(output) as {
                volumes?: {
                    id?: string;
                    name?: string;
                    path?: string;
                    type?: apid.SystemStorageVolumeType;
                    available?: number;
                    used?: number;
                    total?: number;
                }[];
            };
            return (parsed.volumes ?? []).flatMap(volume => {
                if (
                    typeof volume.id !== 'string' ||
                    typeof volume.name !== 'string' ||
                    typeof volume.path !== 'string' ||
                    !this.isStorageVolumeType(volume.type)
                ) {
                    return [];
                }
                return [
                    {
                        id: volume.id,
                        name: volume.name,
                        path: volume.path,
                        type: volume.type,
                        available: Math.max(0, Number(volume.available) || 0),
                        used: Math.max(0, Number(volume.used) || 0),
                        total: Math.max(0, Number(volume.total) || 0),
                    },
                ];
            });
        } catch (_err: any) {
            return [];
        }
    }

    private async getUnixStorageVolumes(): Promise<apid.SystemStorageVolume[]> {
        try {
            const output = await this.runCommand('df', ['-kP']);
            return output
                .split(/\r?\n/)
                .slice(1)
                .flatMap(line => {
                    const columns = line.trim().split(/\s+/);
                    if (columns.length < 6) return [];
                    const [device, total, used, available] = columns;
                    const mountPath = columns.slice(5).join(' ').replace(/\\040/g, ' ');
                    if (!mountPath.startsWith('/') || /^(tmpfs|devtmpfs|overlay)$/i.test(device)) return [];
                    return [
                        {
                            id: device,
                            name: mountPath,
                            path: mountPath,
                            type: 'fixed' as const,
                            available: Math.max(0, Number(available) || 0) * 1024,
                            used: Math.max(0, Number(used) || 0) * 1024,
                            total: Math.max(0, Number(total) || 0) * 1024,
                        },
                    ];
                });
        } catch (_err: any) {
            return [];
        }
    }

    private isStorageVolumeType(value: unknown): value is apid.SystemStorageVolumeType {
        return value === 'fixed' || value === 'removable' || value === 'network' || value === 'other';
    }

    private mergeGpuInfo(nvidiaItems: apid.SystemGpuInfo[], windowsItems: apid.SystemGpuInfo[]): apid.SystemGpuInfo[] {
        const remainingNvidia = nvidiaItems.filter(item => !this.isSoftwareGpuAdapter(item.name));
        const merged = windowsItems
            .filter(item => !this.isSoftwareGpuAdapter(item.name))
            .map(windowsItem => {
                const normalizedWindowsName = this.normalizeGpuName(windowsItem.name);
                const nvidiaIndex = remainingNvidia.findIndex(
                    item => this.normalizeGpuName(item.name) === normalizedWindowsName,
                );
                if (nvidiaIndex === -1) return windowsItem;
                const [nvidiaItem] = remainingNvidia.splice(nvidiaIndex, 1);
                return {
                    ...windowsItem,
                    ...nvidiaItem,
                };
            });

        return [...merged, ...remainingNvidia];
    }

    private isSoftwareGpuAdapter(name: string): boolean {
        const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim();
        return /^(microsoft basic render driver|microsoft basic display adapter|microsoft remote display adapter|remote display adapter)$/.test(
            normalizedName,
        );
    }

    private normalizeGpuName(name: string): string {
        return name
            .toLowerCase()
            .replace(/\(r\)|\(tm\)/g, '')
            .replace(/^(nvidia|intel|amd)\s+/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private async getNvidiaGpuInfo(): Promise<apid.SystemGpuInfo[]> {
        try {
            const output = await this.runCommand('nvidia-smi', [
                '--query-gpu=name,utilization.gpu,memory.total,memory.used',
                '--format=csv,noheader,nounits',
            ]);
            return output
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(line => {
                    const [name, usage, memoryTotal, memoryUsed] = line.split(',').map(value => value.trim());
                    return {
                        name,
                        usagePercent: this.toOptionalNumber(usage),
                        memoryTotal: this.mebibytesToBytes(memoryTotal),
                        memoryUsed: this.mebibytesToBytes(memoryUsed),
                    };
                });
        } catch (_err: any) {
            return [];
        }
    }

    private async getWindowsGpuInfo(): Promise<apid.SystemGpuInfo[]> {
        const script =
            "$memoryByAdapter=@{};Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction SilentlyContinue | ForEach-Object {if($_.Name -match '^(luid_0x[0-9a-f]+_0x[0-9a-f]+)_phys_\\d+$'){ $memoryByAdapter[$matches[1].ToLowerInvariant()]=[pscustomobject]@{used=[double]$_.DedicatedUsage} }};" +
            "$engineTotals=@{};Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | ForEach-Object {if($_.Name -match '_(luid_0x[0-9a-f]+_0x[0-9a-f]+)_phys_(\\d+)_eng_(\\d+)_'){ $adapterKey=$matches[1].ToLowerInvariant();$engineKey=$adapterKey+'|'+$matches[2]+'|'+$matches[3];$engineTotals[$engineKey]=[double]($engineTotals[$engineKey])+[double]$_.UtilizationPercentage }};" +
            '$usageByAdapter=@{};foreach($entry in $engineTotals.GetEnumerator()){$adapterKey=$entry.Key.Split("|")[0];$usage=[Math]::Min(100,[double]$entry.Value);if(-not $usageByAdapter.ContainsKey($adapterKey) -or $usage -gt $usageByAdapter[$adapterKey]){$usageByAdapter[$adapterKey]=$usage}};' +
            "$directX='HKLM:\\SOFTWARE\\Microsoft\\DirectX';$adapters=@(Get-ChildItem $directX -ErrorAction SilentlyContinue | ForEach-Object {$p=Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;$description=[string]$p.Description;if($null -eq $p.AdapterLuid -or [UInt64]$p.AdapterLuid -eq 0 -or [bool]$p.SoftwareAdapter -or [UInt32]$p.VendorId -eq 0x1414 -or $description -match '^(Microsoft Basic (Render Driver|Display Adapter)|Microsoft Remote Display Adapter|Remote Display Adapter)$'){return};$bytes=[BitConverter]::GetBytes([UInt64]$p.AdapterLuid);$low=[BitConverter]::ToUInt32($bytes,0);$high=[BitConverter]::ToUInt32($bytes,4);$key=('luid_0x{0:x8}_0x{1:x8}' -f $high,$low);if(-not $memoryByAdapter.ContainsKey($key)){return};[pscustomobject]@{key=$key;name=$description;usage=if($usageByAdapter.ContainsKey($key)){$usageByAdapter[$key]}else{0};memoryTotal=[double]$p.DedicatedVideoMemory;memoryUsed=$memoryByAdapter[$key].used}});" +
            "$fallback=@(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Where-Object {$_.PNPDeviceID -like 'PCI\\*' -and $_.Name -notmatch '^(Microsoft Basic (Render Driver|Display Adapter)|Microsoft Remote Display Adapter|Remote Display Adapter)$'} | ForEach-Object {[pscustomobject]@{name=$_.Name;memoryTotal=$_.AdapterRAM}});" +
            '$overallUsage=($engineTotals.Values|Measure-Object -Maximum).Maximum;' +
            '[pscustomobject]@{adapters=$adapters;fallback=$fallback;overallUsage=$overallUsage}|ConvertTo-Json -Depth 4 -Compress';
        try {
            const output = await this.runCommand('powershell.exe', [
                '-NoLogo',
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                script,
            ]);
            const parsed = JSON.parse(output) as {
                adapters?: {
                    name?: string;
                    usage?: number | null;
                    memoryTotal?: number | null;
                    memoryUsed?: number | null;
                }[];
                fallback?: { name?: string; memoryTotal?: number | null }[];
                overallUsage?: number | null;
            };
            const adapters = (parsed.adapters ?? [])
                .filter(
                    adapter =>
                        typeof adapter.name === 'string' &&
                        adapter.name.length > 0 &&
                        !this.isSoftwareGpuAdapter(adapter.name),
                )
                .map(adapter => ({
                    name: adapter.name as string,
                    usagePercent: this.toOptionalNumber(adapter.usage),
                    memoryTotal: this.toOptionalByteSize(adapter.memoryTotal),
                    memoryUsed: this.toOptionalNonNegativeByteSize(adapter.memoryUsed),
                }));
            if (adapters.length > 0) return adapters;

            const fallback = (parsed.fallback ?? [])
                .filter(
                    adapter =>
                        typeof adapter.name === 'string' &&
                        adapter.name.length > 0 &&
                        !this.isSoftwareGpuAdapter(adapter.name),
                )
                .map(adapter => ({
                    name: adapter.name as string,
                    memoryTotal: this.toOptionalByteSize(adapter.memoryTotal),
                }));
            const overallUsage = this.toOptionalNumber(parsed.overallUsage);
            return overallUsage === undefined
                ? fallback
                : [...fallback, { name: 'GPU 全体', usagePercent: overallUsage }];
        } catch (_err: any) {
            return [];
        }
    }

    private runCommand(command: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile(
                command,
                args,
                { encoding: 'utf8', timeout: 3_000, windowsHide: true, maxBuffer: 1024 * 1024 },
                (err, stdout) => {
                    if (err !== null) reject(err);
                    else resolve(stdout.trim());
                },
            );
        });
    }

    private toOptionalNumber(value: unknown): number | undefined {
        const result = Number(value);
        return Number.isFinite(result) ? Math.min(100, Math.max(0, result)) : undefined;
    }

    private mebibytesToBytes(value: unknown): number | undefined {
        const result = Number(value);
        return Number.isFinite(result) ? Math.max(0, result) * 1024 * 1024 : undefined;
    }

    private toOptionalByteSize(value: unknown): number | undefined {
        const result = Number(value);
        return Number.isFinite(result) && result > 0 ? result : undefined;
    }

    private toOptionalNonNegativeByteSize(value: unknown): number | undefined {
        const result = Number(value);
        return Number.isFinite(result) && result >= 0 ? result : undefined;
    }

    private getVolumeKey(dirPath: string): string {
        const resolved = path.resolve(dirPath);
        if (process.platform === 'win32') {
            return path.parse(resolved).root.toLowerCase() || resolved.toLowerCase();
        }
        try {
            return `device:${fs.statSync(resolved).dev}`;
        } catch (_err: any) {
            // Fall back to the path root when a configured directory is temporarily unavailable.
        }
        return path.parse(resolved).root || resolved;
    }

    private getDefaultLogDirectory(): string {
        return path.join(__dirname, '..', '..', '..', '..', 'logs');
    }

    private async getCachedDirectorySize(root: string): Promise<number> {
        const cacheKey = path.resolve(root);
        const now = Date.now();
        const cached = this.directorySizeCache.get(cacheKey);
        if (cached !== undefined && cached.expiresAt > now) return cached.size;

        const running = this.directorySizePromises.get(cacheKey);
        if (running !== undefined) return running;

        const promise = this.getDirectoryFileSize(cacheKey)
            .then(size => {
                this.directorySizeCache.set(cacheKey, { expiresAt: Date.now() + 60_000, size });
                return size;
            })
            .finally(() => {
                this.directorySizePromises.delete(cacheKey);
            });
        this.directorySizePromises.set(cacheKey, promise);
        return promise;
    }

    private async getDirectoryFileSize(root: string): Promise<number> {
        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(root, { withFileTypes: true });
        } catch (_err: any) {
            return 0;
        }

        const files = entries.filter(entry => entry.isFile()).map(entry => path.join(root, entry.name));
        let total = 0;
        for (let index = 0; index < files.length; index += 128) {
            const sizes = await Promise.all(
                files.slice(index, index + 128).map(async filePath => {
                    try {
                        return (await fs.promises.stat(filePath)).size;
                    } catch (_err: any) {
                        // Files can disappear while their directory is being measured.
                        return 0;
                    }
                }),
            );
            total += sizes.reduce((subtotal, size) => subtotal + size, 0);
        }
        return total;
    }

    /**
     * 指定したディレクトリのディスク使用情報を取得する
     * @param dirPath ディスクディレクトリ
     */
    private getDiskInfo(dirPath: string): Promise<apid.DiskUsage> {
        return new Promise<apid.DiskUsage>((resolve, reject) => {
            diskusage(dirPath, (err, usage) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        available: usage.available,
                        used: usage.used,
                        total: usage.total,
                    });
                }
            });
        });
    }
}
