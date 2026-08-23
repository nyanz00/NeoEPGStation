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
import { getRuntimeLogLevel, setRuntimeLogLevel } from '../../RuntimeLogLevel';
import IStorageApiModel from './IStorageApiModel';

interface CpuTimes {
    idle: number;
    total: number;
}

interface StorageBreakdownSummary {
    sizeByDirectory: Map<string, number>;
    dropLogSize: number;
    thumbnailSize: number;
}

interface LinuxGpuDescriptor {
    name: string;
    devicePath: string;
    vendorId: string;
}

@injectable()
export default class StorageApiModel implements IStorageApiModel {
    private config: IConfigFile;
    private videoFileDB: IVideoFileDB;
    private previousCpuTimes: CpuTimes | null = null;
    private directorySizeCache: Map<string, { expiresAt: number; size: number }> = new Map();
    private directorySizePromises: Map<string, Promise<number>> = new Map();
    private sizeSummaryCache: { expiresAt: number; items: { parentDirectoryName: string; size: number }[] } | null =
        null;
    private sizeSummaryPromise: Promise<{ parentDirectoryName: string; size: number }[]> | null = null;
    private storageBreakdownCache: { expiresAt: number; value: StorageBreakdownSummary } | null = null;
    private storageBreakdownPromise: Promise<StorageBreakdownSummary> | null = null;
    private systemInfoCache: { expiresAt: number; info: apid.SystemResourceInfo } | null = null;
    private systemInfoPromise: Promise<apid.SystemResourceInfo> | null = null;
    private gpuCache: { expiresAt: number; items: apid.SystemGpuInfo[] } | null = null;
    private gpuLoadPromise: Promise<apid.SystemGpuInfo[]> | null = null;
    private storageVolumeCache: { expiresAt: number; items: apid.SystemStorageVolume[] } | null = null;
    private storageVolumePromise: Promise<apid.SystemStorageVolume[]> | null = null;
    private readonly systemDescriptor: {
        hostname: string;
        platform: string;
        arch: string;
        cpuModel: string;
        logicalCores: number;
        totalMemory: number;
        pid: number;
    };
    private gpuDescriptors: Pick<apid.SystemGpuInfo, 'name' | 'memoryTotal'>[] | null = null;
    private linuxGpuDescriptors: LinuxGpuDescriptor[] | null = null;
    private storageVolumeDescriptors:
        Pick<apid.SystemStorageVolume, 'id' | 'name' | 'path' | 'type' | 'total'>[] | null = null;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
    ) {
        this.config = configuration.getConfig();
        this.videoFileDB = videoFileDB;
        const cpus = os.cpus();
        this.systemDescriptor = {
            hostname: os.hostname(),
            platform: `${os.type()} ${os.release()}`,
            arch: os.arch(),
            cpuModel: cpus[0]?.model.trim() ?? 'Unknown CPU',
            logicalCores: cpus.length,
            totalMemory: os.totalmem(),
            pid: process.pid,
        };
        // Seed the CPU sample when the singleton is created so the first page
        // request can calculate usage without blocking for a second sample.
        this.previousCpuTimes = this.readCpuTimes();
    }

    /**
     * recorded のディスク情報を返す
     * @return Promise<apid.StorageInfo>
     */
    public async getInfo(): Promise<apid.StorageInfo> {
        const items: apid.StorageItem[] = [];
        const [diskInfos, system] = await Promise.all([
            Promise.all(this.config.recorded.map(recorded => this.getDiskInfo(recorded.path))),
            this.getSystemInfo(),
        ]);
        const now = Date.now();
        const breakdown = this.storageBreakdownCache?.value;
        const breakdownPending = this.storageBreakdownCache === null || this.storageBreakdownCache.expiresAt <= now;
        if (breakdownPending) {
            // Capacity and system cards must not wait for a full directory walk.
            // The next 5-second refresh will pick up the completed breakdown.
            void this.getStorageBreakdown().catch(() => undefined);
        }
        const sizeByDirectory = breakdown?.sizeByDirectory;
        const recordedSizeByVolume = new Map<string, number>();

        for (const recorded of this.config.recorded) {
            const volume = this.getVolumeKey(recorded.path);
            recordedSizeByVolume.set(
                volume,
                (recordedSizeByVolume.get(volume) ?? 0) + (sizeByDirectory?.get(recorded.name) ?? 0),
            );
        }
        const dropLogVolume = breakdown === undefined ? undefined : this.getVolumeKey(this.config.dropLog);
        const thumbnailVolume = breakdown === undefined ? undefined : this.getVolumeKey(this.config.thumbnail);

        for (const [index, r] of this.config.recorded.entries()) {
            const info = diskInfos[index];
            const volume = this.getVolumeKey(r.path);
            const recorded = recordedSizeByVolume.get(volume) ?? 0;
            const dropLogs = volume === dropLogVolume ? (breakdown?.dropLogSize ?? 0) : 0;
            const thumbnails = volume === thumbnailVolume ? (breakdown?.thumbnailSize ?? 0) : 0;
            items.push({
                ...info,
                name: r.name,
                ...(breakdownPending ? { breakdownPending: true } : {}),
                breakdown: {
                    recorded,
                    dropLogs,
                    thumbnails,
                    other:
                        breakdown === undefined ? info.used : Math.max(0, info.used - recorded - dropLogs - thumbnails),
                },
            });
        }

        return {
            items,
            system,
        };
    }

    private async getStorageBreakdown(): Promise<StorageBreakdownSummary> {
        const now = Date.now();
        if (this.storageBreakdownCache !== null && this.storageBreakdownCache.expiresAt > now) {
            return this.storageBreakdownCache.value;
        }
        if (this.storageBreakdownPromise !== null) return this.storageBreakdownPromise;

        const loadPromise = Promise.all([
            this.getCachedSizeSummaries(),
            this.getCachedDirectorySize(this.config.dropLog),
            this.getCachedDirectorySize(this.config.thumbnail),
        ])
            .then(([sizeSummaries, dropLogSize, thumbnailSize]) => {
                const value = {
                    sizeByDirectory: new Map(sizeSummaries.map(item => [item.parentDirectoryName, item.size])),
                    dropLogSize,
                    thumbnailSize,
                };
                this.storageBreakdownCache = { expiresAt: Date.now() + 15_000, value };
                return value;
            })
            .finally(() => {
                if (this.storageBreakdownPromise === loadPromise) this.storageBreakdownPromise = null;
            });
        this.storageBreakdownPromise = loadPromise;
        return loadPromise;
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
                    level: getRuntimeLogLevel(source, category),
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
                level: getRuntimeLogLevel(source, category),
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

    public async setLogLevel(
        source: apid.SystemLogSource,
        category: apid.SystemLogCategory,
        level: apid.SystemLogLevel,
    ): Promise<apid.SystemLogLevelSetting> {
        setRuntimeLogLevel(source, category, level);
        return { source, category, level };
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
        if (this.storageVolumePromise !== null) {
            const items = await this.storageVolumePromise;
            return { items, sampledAt: now };
        }
        const loadPromise = (
            process.platform === 'win32' ? this.getWindowsStorageVolumes() : this.getUnixStorageVolumes()
        )
            .then(allVolumes => {
                const primaryVolumes = new Set(this.config.recorded.map(recorded => this.getVolumeKey(recorded.path)));
                const sampledItems = allVolumes.filter(volume => !primaryVolumes.has(this.getVolumeKey(volume.path)));
                if (this.storageVolumeDescriptors === null && sampledItems.length > 0) {
                    this.storageVolumeDescriptors = sampledItems.map(({ id, name, path: volumePath, type, total }) => ({
                        id,
                        name,
                        path: volumePath,
                        type,
                        total,
                    }));
                }
                const items = this.mergeStorageVolumeSamples(sampledItems);
                this.storageVolumeCache = { expiresAt: Date.now() + 30_000, items };
                return items;
            })
            .finally(() => {
                if (this.storageVolumePromise === loadPromise) this.storageVolumePromise = null;
            });
        this.storageVolumePromise = loadPromise;
        const items = await loadPromise;
        return {
            items,
            sampledAt: now,
        };
    }

    public async getSystemInfo(): Promise<apid.SystemResourceInfo> {
        const now = Date.now();
        if (this.systemInfoCache !== null && this.systemInfoCache.expiresAt > now) return this.systemInfoCache.info;
        if (this.systemInfoPromise !== null) return this.systemInfoPromise;

        const loadPromise = this.loadSystemInfo();
        this.systemInfoPromise = loadPromise;
        try {
            return await loadPromise;
        } finally {
            if (this.systemInfoPromise === loadPromise) this.systemInfoPromise = null;
        }
    }

    private async loadSystemInfo(): Promise<apid.SystemResourceInfo> {
        const totalMemory = this.systemDescriptor.totalMemory;
        const availableMemory = os.freemem();
        const usedMemory = Math.max(0, totalMemory - availableMemory);
        const cpu = await this.getCpuInfo();

        const info = {
            hostname: this.systemDescriptor.hostname,
            platform: this.systemDescriptor.platform,
            arch: this.systemDescriptor.arch,
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
                pid: this.systemDescriptor.pid,
                uptime: process.uptime(),
                memoryUsed: process.memoryUsage().rss,
            },
        };
        this.systemInfoCache = { expiresAt: Date.now() + 5_000, info };
        return info;
    }

    private async getCpuInfo(): Promise<apid.SystemCpuInfo> {
        const current = this.readCpuTimes();
        const previous = this.previousCpuTimes;
        this.previousCpuTimes = current;
        if (previous === null) {
            return {
                model: this.systemDescriptor.cpuModel,
                logicalCores: this.systemDescriptor.logicalCores,
                usagePercent: 0,
            };
        }
        const totalDelta = Math.max(0, current.total - previous.total);
        const idleDelta = Math.max(0, current.idle - previous.idle);
        const usagePercent = totalDelta > 0 ? Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100)) : 0;
        return {
            model: this.systemDescriptor.cpuModel,
            logicalCores: this.systemDescriptor.logicalCores,
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
        if (this.gpuCache !== null) {
            if (this.gpuCache.expiresAt <= now && this.gpuLoadPromise === null) {
                void this.refreshGpuItems(now).catch(() => undefined);
            }
            return this.gpuCache.items;
        }

        if (this.gpuLoadPromise !== null) return this.gpuLoadPromise;

        return this.refreshGpuItems(now);
    }

    private async refreshGpuItems(now: number): Promise<apid.SystemGpuInfo[]> {
        const loadPromise = this.loadGpuItems(now);
        this.gpuLoadPromise = loadPromise;
        try {
            return await loadPromise;
        } finally {
            if (this.gpuLoadPromise === loadPromise) this.gpuLoadPromise = null;
        }
    }

    private async loadGpuItems(now: number): Promise<apid.SystemGpuInfo[]> {
        let nvidiaItems: apid.SystemGpuInfo[];
        let platformItems: apid.SystemGpuInfo[];
        if (process.platform === 'linux') {
            nvidiaItems = await this.getNvidiaGpuInfo();
            platformItems = await this.getLinuxGpuInfo(nvidiaItems.length > 0);
        } else {
            [nvidiaItems, platformItems] = await Promise.all([
                this.getNvidiaGpuInfo(),
                process.platform === 'win32' ? this.getWindowsGpuInfo() : Promise.resolve([]),
            ]);
        }
        const sampledItems = this.mergeGpuInfo(nvidiaItems, platformItems);
        if (sampledItems.length > 0) {
            if (this.gpuDescriptors === null) this.gpuDescriptors = [];
            const sampledNameCounts = new Map<string, number>();
            for (const { name, memoryTotal } of sampledItems) {
                const normalizedName = this.normalizeGpuName(name);
                const occurrence = sampledNameCounts.get(normalizedName) ?? 0;
                sampledNameCounts.set(normalizedName, occurrence + 1);
                const existing = this.gpuDescriptors.filter(
                    descriptor => this.normalizeGpuName(descriptor.name) === normalizedName,
                )[occurrence];
                if (typeof existing === 'undefined') {
                    this.gpuDescriptors.push({ name, memoryTotal });
                } else if (existing.memoryTotal === undefined && memoryTotal !== undefined) {
                    existing.memoryTotal = memoryTotal;
                }
            }
        }
        const items = this.mergeGpuSamples(sampledItems);
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

    private mergeStorageVolumeSamples(sampledItems: apid.SystemStorageVolume[]): apid.SystemStorageVolume[] {
        if (this.storageVolumeDescriptors === null) return sampledItems;
        const previousItems = this.storageVolumeCache?.items ?? [];
        return this.storageVolumeDescriptors.map(descriptor => {
            const sample = sampledItems.find(item => item.id === descriptor.id);
            const previous = previousItems.find(item => item.id === descriptor.id);
            return {
                ...descriptor,
                available: sample?.available ?? previous?.available ?? descriptor.total,
                used: sample?.used ?? previous?.used ?? 0,
            };
        });
    }

    private mergeGpuInfo(nvidiaItems: apid.SystemGpuInfo[], platformItems: apid.SystemGpuInfo[]): apid.SystemGpuInfo[] {
        const remainingNvidia = nvidiaItems.filter(item => !this.isSoftwareGpuAdapter(item.name));
        const merged = platformItems
            .filter(item => !this.isSoftwareGpuAdapter(item.name))
            .map(platformItem => {
                const normalizedPlatformName = this.normalizeGpuName(platformItem.name);
                const nvidiaIndex = remainingNvidia.findIndex(
                    item => this.normalizeGpuName(item.name) === normalizedPlatformName,
                );
                if (nvidiaIndex === -1) return platformItem;
                const [nvidiaItem] = remainingNvidia.splice(nvidiaIndex, 1);
                return {
                    ...platformItem,
                    ...nvidiaItem,
                };
            });

        return [...merged, ...remainingNvidia];
    }

    private mergeGpuSamples(sampledItems: apid.SystemGpuInfo[]): apid.SystemGpuInfo[] {
        if (this.gpuDescriptors === null) return sampledItems;
        const previousItems = this.gpuCache?.items ?? [];
        return this.gpuDescriptors.map(descriptor => {
            const normalizedName = this.normalizeGpuName(descriptor.name);
            const sample = sampledItems.find(item => this.normalizeGpuName(item.name) === normalizedName);
            const previous = previousItems.find(item => this.normalizeGpuName(item.name) === normalizedName);
            return {
                ...descriptor,
                usagePercent: sample?.usagePercent ?? previous?.usagePercent,
                memoryUsed: sample?.memoryUsed ?? previous?.memoryUsed,
            };
        });
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

    private async getLinuxGpuInfo(excludeNvidia: boolean): Promise<apid.SystemGpuInfo[]> {
        const descriptors = this.linuxGpuDescriptors ?? (await this.getLinuxGpuDescriptors());
        this.linuxGpuDescriptors = descriptors;
        return Promise.all(
            descriptors
                .filter(descriptor => !excludeNvidia || descriptor.vendorId !== '10de')
                .map(async descriptor => {
                    const [usage, memoryTotal, memoryUsed] = await Promise.all([
                        this.readLinuxSysfsValue(path.join(descriptor.devicePath, 'gpu_busy_percent')),
                        this.readLinuxSysfsValue(path.join(descriptor.devicePath, 'mem_info_vram_total')),
                        this.readLinuxSysfsValue(path.join(descriptor.devicePath, 'mem_info_vram_used')),
                    ]);
                    return {
                        name: descriptor.name,
                        usagePercent: this.toOptionalNumber(usage),
                        memoryTotal: this.toOptionalByteSize(memoryTotal),
                        memoryUsed: this.toOptionalNonNegativeByteSize(memoryUsed),
                    };
                }),
        );
    }

    private async getLinuxGpuDescriptors(): Promise<LinuxGpuDescriptor[]> {
        const drmPath = '/sys/class/drm';
        try {
            const [entries, pciNames] = await Promise.all([
                fs.promises.readdir(drmPath, { withFileTypes: true }),
                this.getLinuxPciGpuNames(),
            ]);
            const descriptors = await Promise.all(
                entries
                    .filter(entry => /^card\d+$/.test(entry.name))
                    .map(async (entry): Promise<LinuxGpuDescriptor | undefined> => {
                        const devicePath = path.join(drmPath, entry.name, 'device');
                        const realDevicePath = await fs.promises.realpath(devicePath).catch(() => devicePath);
                        const [vendorId, deviceId, deviceClass] = await Promise.all([
                            this.readLinuxSysfsValue(path.join(devicePath, 'vendor')),
                            this.readLinuxSysfsValue(path.join(devicePath, 'device')),
                            this.readLinuxSysfsValue(path.join(devicePath, 'class')),
                        ]);
                        const normalizedVendorId = vendorId?.replace(/^0x/i, '').toLowerCase();
                        const normalizedDeviceId = deviceId?.replace(/^0x/i, '').toLowerCase();
                        if (
                            normalizedVendorId === undefined ||
                            normalizedDeviceId === undefined ||
                            (deviceClass !== undefined && !/^0x03/i.test(deviceClass))
                        ) {
                            return undefined;
                        }

                        const pciAddress = path.basename(realDevicePath);
                        return {
                            name:
                                pciNames.get(pciAddress) ??
                                this.getLinuxFallbackGpuName(normalizedVendorId, normalizedDeviceId),
                            devicePath,
                            vendorId: normalizedVendorId,
                        };
                    }),
            );
            return descriptors.filter((item): item is LinuxGpuDescriptor => item !== undefined);
        } catch (_err: any) {
            return [];
        }
    }

    private async getLinuxPciGpuNames(): Promise<Map<string, string>> {
        const names = new Map<string, string>();
        try {
            const output = await this.runCommand('lspci', ['-Dmm', '-nn']);
            for (const line of output.split(/\r?\n/)) {
                const match = line.match(/^(\S+)\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"/);
                if (match === null || !/\[(?:0300|0302|0380)\]/i.test(match[2])) continue;
                const vendor = match[3].replace(/\s+\[[0-9a-f]{4}\]$/i, '').trim();
                const device = match[4].replace(/\s+\[[0-9a-f]{4}\]$/i, '').trim();
                names.set(match[1], `${vendor} ${device}`.trim());
            }
        } catch (_err: any) {
            // pciutils is optional. The DRM sysfs identifiers still provide a stable fallback.
        }
        return names;
    }

    private async readLinuxSysfsValue(filePath: string): Promise<string | undefined> {
        try {
            return (await fs.promises.readFile(filePath, 'utf8')).trim();
        } catch (_err: any) {
            return undefined;
        }
    }

    private getLinuxFallbackGpuName(vendorId: string, deviceId: string): string {
        const vendorNames: Record<string, string> = {
            '1002': 'AMD',
            '10de': 'NVIDIA',
            '8086': 'Intel',
        };
        return `${vendorNames[vendorId] ?? 'GPU'} [${vendorId}:${deviceId}]`;
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
            if (adapters.length > 0) {
                // GPU performance counters can be initialized per adapter. Keep hardware
                // adapters found by Win32_VideoController when a counter is not ready yet.
                const adapterNames = new Set(adapters.map(adapter => this.normalizeGpuName(adapter.name)));
                return [
                    ...adapters,
                    ...fallback.filter(adapter => !adapterNames.has(this.normalizeGpuName(adapter.name))),
                ];
            }
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

    private async getCachedSizeSummaries(): Promise<{ parentDirectoryName: string; size: number }[]> {
        const now = Date.now();
        if (this.sizeSummaryCache !== null && this.sizeSummaryCache.expiresAt > now) return this.sizeSummaryCache.items;
        if (this.sizeSummaryPromise !== null) return this.sizeSummaryPromise;

        const loadPromise = this.videoFileDB
            .getSizeSummaries()
            .then(items => {
                this.sizeSummaryCache = { expiresAt: Date.now() + 15_000, items };
                return items;
            })
            .finally(() => {
                if (this.sizeSummaryPromise === loadPromise) this.sizeSummaryPromise = null;
            });
        this.sizeSummaryPromise = loadPromise;
        return loadPromise;
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
