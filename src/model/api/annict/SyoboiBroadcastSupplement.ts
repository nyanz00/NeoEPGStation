import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import SyoboiCalendarClient, { SyoboiProgram } from './SyoboiCalendarClient';

export interface SupplementWork {
    annictId: number;
    title: string;
    syobocalTid?: number;
    media?: string;
    hasTelevisionChannels?: boolean;
    missingBroadcasts?: boolean;
    defer?: boolean;
}

interface SupplementCache {
    checkedAt?: number;
    attemptedAt?: number;
    tid?: number;
    programs: SyoboiProgram[];
    error?: string;
}

export interface SupplementState extends SupplementCache {
    pending: boolean;
}

interface SupplementTask {
    work: SupplementWork;
    season: string;
    priority: number;
}

const CACHE_AGE = 6 * 60 * 60 * 1000;
const RETRY_AGE = 5 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** Shared background queue: every UI reads the same cache without waiting for external requests. */
export default class SyoboiBroadcastSupplement {
    private readonly queue = new Map<string, SupplementTask>();
    private readonly active = new Set<string>();
    private readonly writes = new Map<string, Promise<void>>();
    private processing?: Promise<void>;

    constructor(
        private readonly root: string,
        private readonly client: SyoboiCalendarClient,
        private readonly warn: (message: string) => void,
    ) {}

    public async readAndQueue(
        works: SupplementWork[],
        season: string,
        detail = false,
        force = false,
    ): Promise<SupplementState[]> {
        const states: SupplementState[] = [];
        for (const work of works) {
            // WEB is excluded unless actual television stations are known. Missing dates alone are not evidence.
            if (work.media?.toUpperCase() === 'WEB' && work.hasTelevisionChannels !== true) {
                states.push({ programs: [], pending: false });
                continue;
            }
            const key = this.key(work.annictId, season);
            const cached = (await this.read<SupplementCache>(this.file(key))) ?? { programs: [] };
            const fresh =
                cached.error === undefined &&
                cached.checkedAt !== undefined &&
                Date.now() - cached.checkedAt < CACHE_AGE;
            const coolingDown = cached.error !== undefined && Date.now() - (cached.attemptedAt ?? 0) < RETRY_AGE;
            if (work.defer !== true && (!fresh || force) && (!coolingDown || force) && !this.active.has(key)) {
                const priority = detail ? 0 : work.missingBroadcasts ? 1 : 2;
                const queued = this.queue.get(key);
                this.queue.set(key, {
                    work: { ...work, syobocalTid: work.syobocalTid ?? cached.tid },
                    season,
                    priority: Math.min(priority, queued?.priority ?? priority),
                });
            }
            states.push({ ...cached, pending: this.queue.has(key) || this.active.has(key) });
        }
        this.start();
        return states;
    }

    /** Rerun discovery seeds the same cache but does not claim that initial-broadcast lookup is complete. */
    public async seed(annictId: number, season: string, tid: number, programs: SyoboiProgram[]): Promise<void> {
        const key = this.key(annictId, season);
        await this.update(key, current => ({
            ...current,
            tid,
            programs: this.unique([...current.programs, ...programs]),
        }));
    }

    public async waitForIdle(): Promise<void> {
        await this.processing;
    }

    private start(): void {
        if (this.processing !== undefined || this.queue.size === 0) return;
        this.processing = Promise.resolve()
            .then(async () => {
                while (this.queue.size > 0) {
                    const ordered = [...this.queue.entries()].sort((a, b) => a[1].priority - b[1].priority);
                    const season = ordered[0][1].season;
                    let unresolved = 0;
                    const batch = ordered
                        .filter(([, task]) => {
                            if (task.season !== season) return false;
                            // Avoid making a selected detail wait behind dozens of title-search requests.
                            if (task.work.syobocalTid === undefined && unresolved++ > 0) return false;
                            return true;
                        })
                        .slice(0, 50);
                    for (const [key] of batch) {
                        this.queue.delete(key);
                        this.active.add(key);
                    }
                    try {
                        await this.refresh(batch.map(([, task]) => task));
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        this.warn(`Syoboi broadcast supplement failed: ${message}`);
                        await Promise.all(
                            batch.map(([key]) =>
                                this.update(key, cached => ({
                                    ...cached,
                                    attemptedAt: Date.now(),
                                    error: '放送情報の補完に失敗しました。時間をおいて再取得してください。',
                                })).catch(() => undefined),
                            ),
                        );
                    } finally {
                        batch.forEach(([key]) => this.active.delete(key));
                    }
                }
            })
            .finally(() => {
                this.processing = undefined;
                this.start();
            });
    }

    private async refresh(tasks: SupplementTask[]): Promise<void> {
        const resolved: { task: SupplementTask; tid: number }[] = [];
        for (const task of tasks) {
            const key = this.key(task.work.annictId, task.season);
            try {
                const tid = await this.resolveTid(task.work, task.season);
                if (tid === undefined) {
                    await this.update(key, cached => ({ ...cached, checkedAt: Date.now(), error: undefined }));
                } else {
                    resolved.push({ task, tid });
                }
            } catch (err) {
                this.warn(
                    `Syoboi title lookup failed: annictId=${task.work.annictId}, error=${err instanceof Error ? err.message : String(err)}`,
                );
                await this.update(key, cached => ({
                    ...cached,
                    attemptedAt: Date.now(),
                    error: '作品の放送情報を確認できませんでした。時間をおいて再取得してください。',
                }));
            }
        }
        if (resolved.length === 0) return;
        const season = tasks[0].season;
        const [start, end] = this.range(season);
        const tids = [...new Set(resolved.map(item => item.tid))];
        const first = await this.client.getPrograms(tids, this.date(start), this.date(end));
        // Publish first-slot progress even if the later nearby lookup fails.
        for (const { task, tid } of resolved) {
            await this.update(this.key(task.work.annictId, season), cached => ({
                ...cached,
                tid,
                programs: this.unique([...cached.programs, ...first.filter(program => program.tid === tid)]),
            }));
        }
        const missing = tids.filter(tid => {
            const slots = first.filter(program => program.tid === tid && !program.rebroadcast);
            return slots.length === 0 || slots.some(program => Date.parse(program.startedAt) < Date.now());
        });
        let additional: SyoboiProgram[] = [];
        if (missing.length > 0) {
            // A bounded nearby window supplies available slots without downloading every episode in the season.
            const nearby = Math.max(start, Math.min(Date.now(), end - 32 * DAY));
            additional = await this.client.getPrograms(
                missing,
                this.date(nearby),
                this.date(Math.min(end, nearby + 32 * DAY)),
                false,
            );
        }
        for (const { task, tid } of resolved) {
            const programs = this.unique([...first, ...additional].filter(program => program.tid === tid));
            await this.update(this.key(task.work.annictId, season), cached => ({
                ...cached,
                tid,
                checkedAt: Date.now(),
                attemptedAt: undefined,
                error: undefined,
                // Keep rerun discoveries; freshly queried slots replace older versions with the same PID.
                programs: this.unique([...cached.programs.filter(program => program.rebroadcast), ...programs]),
            }));
        }
    }

    private async resolveTid(work: SupplementWork, season: string): Promise<number | undefined> {
        if (Number.isInteger(work.syobocalTid) && work.syobocalTid! > 0) return work.syobocalTid;
        const file = path.join(this.root, `syoboi-title-v1-${work.annictId}.json`);
        const cached = await this.read<{ title: string; checkedAt: number; tid?: number }>(file);
        if (
            cached?.title === work.title &&
            Date.now() - cached.checkedAt < (cached.tid === undefined ? CACHE_AGE : 30 * DAY)
        )
            return cached.tid;
        const normalize = (title: string): string =>
            title.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s/g, '');
        const matches = (await this.client.searchTitle(work.title)).filter(
            title => normalize(title.title) === normalize(work.title),
        );
        const [year, name] = season.split('-');
        const month = ['winter', 'spring', 'summer', 'autumn'].indexOf(name) * 3 + 1;
        const seasonal = matches.filter(
            title =>
                title.firstYear === Number(year) &&
                title.firstMonth !== undefined &&
                title.firstMonth >= month &&
                title.firstMonth < month + 3,
        );
        const candidates = seasonal.length > 0 ? seasonal : matches;
        const tid = candidates.length === 1 ? candidates[0].tid : undefined;
        await this.write(file, { title: work.title, checkedAt: Date.now(), tid });
        return tid;
    }

    private range(season: string): [number, number] {
        const match = /^(\d{4})-(winter|spring|summer|autumn)$/.exec(season);
        if (match === null) throw new Error('Invalid broadcast supplement season');
        const month = ['winter', 'spring', 'summer', 'autumn'].indexOf(match[2]) * 3;
        return [
            Date.UTC(Number(match[1]), month, 1) - 9 * 60 * 60 * 1000 - 14 * DAY,
            Date.UTC(Number(match[1]), month + 3, 1) - 9 * 60 * 60 * 1000 + 14 * DAY,
        ];
    }

    private date(time: number): string {
        // The calendar accepts Japan-local timestamps, independent of the host timezone.
        return new Date(time + 9 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
    }

    private key(annictId: number, season: string): string {
        if (!Number.isInteger(annictId) || annictId <= 0 || !/^\d{4}-(winter|spring|summer|autumn)$/.test(season))
            throw new Error('Invalid broadcast supplement key');
        return `${annictId}-${season}`;
    }

    private file(key: string): string {
        return path.join(this.root, `syoboi-broadcasts-v1-${key}.json`);
    }

    private unique(programs: SyoboiProgram[]): SyoboiProgram[] {
        return [...new Map(programs.map(program => [program.pid, program])).values()].sort(
            (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
        );
    }

    private async update(key: string, change: (cached: SupplementCache) => SupplementCache): Promise<void> {
        const previous = this.writes.get(key) ?? Promise.resolve();
        const write = previous
            .catch(() => undefined)
            .then(async () => {
                const cached = (await this.read<SupplementCache>(this.file(key))) ?? { programs: [] };
                await this.write(this.file(key), change(cached));
            });
        this.writes.set(key, write);
        try {
            await write;
        } finally {
            if (this.writes.get(key) === write) this.writes.delete(key);
        }
    }

    private async read<T>(file: string): Promise<T | null> {
        try {
            return JSON.parse(await fs.promises.readFile(file, 'utf8')) as T;
        } catch (err: any) {
            if (err.code === 'ENOENT' || err instanceof SyntaxError) return null;
            throw err;
        }
    }

    private async write(file: string, value: unknown): Promise<void> {
        await fs.promises.mkdir(this.root, { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
            await fs.promises.writeFile(temporary, JSON.stringify(value), 'utf8');
            await fs.promises.rename(temporary, file);
        } finally {
            await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
        }
    }
}
