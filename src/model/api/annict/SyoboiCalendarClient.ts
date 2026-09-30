import axios from 'axios';

export interface SyoboiProgram {
    pid: number;
    tid: number;
    channelId: number;
    channelName: string;
    channelGroup: number;
    count: number;
    startedAt: string;
    rebroadcast: boolean;
}

export interface SyoboiTitle {
    tid: number;
    title: string;
    firstYear?: number;
    firstMonth?: number;
}

interface SyoboiChannel {
    name: string;
    group: number;
}

const BASE_URL = 'https://cal.syoboi.jp';
const USER_AGENT = 'NeoEPGStation (+https://github.com/nyanz00/NeoEPGStation)';
const REQUEST_INTERVAL_MS = 1100;
const CHANNEL_CACHE_MS = 24 * 60 * 60 * 1000;

/** A small HTTP client for the public Syoboi Calendar endpoints. */
export default class SyoboiCalendarClient {
    private requestQueue: Promise<void> = Promise.resolve();
    private lastRequestStartedAt = 0;
    private channelCache?: Map<number, SyoboiChannel>;
    private channelCacheExpiresAt = 0;
    private channelLookupPromise?: Promise<Map<number, SyoboiChannel>>;

    public async getPrograms(tids: number[], start: string, end: string, firstOnly = true): Promise<SyoboiProgram[]> {
        if (!Array.isArray(tids) || tids.some(tid => !Number.isInteger(tid) || tid <= 0)) {
            throw new Error('しょぼいカレンダーのTIDが不正です');
        }
        if (!this.isSyoboiDate(start) || !this.isSyoboiDate(end)) {
            throw new Error('しょぼいカレンダーの日付が不正です');
        }
        if (tids.length === 0) return [];

        const params: Record<string, string> = {
            Command: 'ProgLookup',
            TID: tids.join(','),
            StTime: `${start}-${end}`,
            Fields: 'PID,TID,ChID,StTime,Count,Flag',
        };
        if (firstOnly) params.Count = '1';

        const response = await this.request<string>(`${BASE_URL}/db.php`, params);
        const rows = this.parseProgramItems(response);
        if (rows.length >= 5000) {
            throw new Error('しょぼいカレンダーの番組取得が5000件上限に達しました');
        }
        if (rows.length === 0) return [];

        const channels = await this.getChannels();
        const results: SyoboiProgram[] = [];
        for (const row of rows) {
            const pid = this.parsePositiveInteger(row.PID);
            const tid = this.parsePositiveInteger(row.TID);
            const channelId = this.parsePositiveInteger(row.ChID);
            const count = this.parseInteger(row.Count);
            const flag = this.parseInteger(row.Flag);
            const startedAt = this.toIsoDate(row.StTime);
            const channel = channelId === undefined ? undefined : channels.get(channelId);
            if (
                pid === undefined ||
                tid === undefined ||
                channelId === undefined ||
                count === undefined ||
                flag === undefined ||
                startedAt === undefined ||
                channel === undefined
            )
                continue;

            results.push({
                pid,
                tid,
                channelId,
                channelName: channel.name,
                channelGroup: channel.group,
                count,
                startedAt,
                rebroadcast: (flag & 8) !== 0,
            });
        }
        return results;
    }

    public async searchTitle(title: string): Promise<SyoboiTitle[]> {
        const response = await this.request<unknown>(`${BASE_URL}/json.php`, {
            Req: 'TitleSearch',
            Search: title,
            Limit: '20',
        });
        const rawTitles =
            typeof response === 'object' && response !== null ? (response as { Titles?: unknown }).Titles : undefined;
        const titleRows = Array.isArray(rawTitles)
            ? rawTitles
            : typeof rawTitles === 'object' && rawTitles !== null
              ? Object.values(rawTitles as Record<string, unknown>)
              : undefined;
        if (titleRows === undefined) {
            throw new Error('しょぼいカレンダーのタイトル検索応答の形式が不正です');
        }
        const titles: SyoboiTitle[] = [];
        for (const value of titleRows) {
            if (typeof value !== 'object' || value === null) continue;
            const row = value as Record<string, unknown>;
            const tid = this.parsePositiveInteger(row.TID);
            if (tid === undefined || typeof row.Title !== 'string' || row.Title.trim() === '') continue;
            const firstYear = this.parsePositiveInteger(row.FirstYear);
            const firstMonth = this.parsePositiveInteger(row.FirstMonth);
            titles.push({
                tid,
                title: row.Title,
                ...(firstYear === undefined ? {} : { firstYear }),
                ...(firstMonth === undefined ? {} : { firstMonth }),
            });
        }
        return titles;
    }

    public async getRss(params: { start: string; days: number; alt: string }): Promise<unknown> {
        return this.request<unknown>(`${BASE_URL}/rss2.php`, {
            start: params.start,
            days: String(params.days),
            alt: params.alt,
        });
    }

    private async request<T>(url: string, params: Record<string, string>): Promise<T> {
        return this.enqueue(async () => {
            const response = await axios.get<T>(url, {
                params,
                timeout: 20_000,
                headers: { 'User-Agent': USER_AGENT },
            });
            return response.data;
        });
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.requestQueue.then(async () => {
            await this.waitForSlot();
            this.lastRequestStartedAt = Date.now();
            return operation();
        });
        this.requestQueue = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    /** Kept separate so tests can bypass wall-clock throttling. */
    private async waitForSlot(): Promise<void> {
        const remaining = REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestStartedAt);
        if (this.lastRequestStartedAt > 0 && remaining > 0) {
            await new Promise<void>(resolve => setTimeout(resolve, remaining));
        }
    }

    private async getChannels(): Promise<Map<number, SyoboiChannel>> {
        if (this.channelCache !== undefined && Date.now() < this.channelCacheExpiresAt) return this.channelCache;
        if (this.channelLookupPromise !== undefined) return this.channelLookupPromise;

        const lookup = this.request<string>(`${BASE_URL}/db.php`, { Command: 'ChLookup' })
            .then(xml => {
                const channels = this.parseChannelItems(xml);
                this.channelCache = channels;
                this.channelCacheExpiresAt = Date.now() + CHANNEL_CACHE_MS;
                return channels;
            })
            .finally(() => {
                this.channelLookupPromise = undefined;
            });
        this.channelLookupPromise = lookup;
        return lookup;
    }

    private parseProgramItems(xml: string): Array<Record<string, string>> {
        const response = this.getXmlBody(xml, 'ProgLookupResponse', 'ProgItems');
        if (response.resultCode !== '200') {
            throw new Error(
                `しょぼいカレンダーの番組取得に失敗しました (Result Code=${response.resultCode ?? 'missing'})`,
            );
        }
        return this.parseItems(response.body, 'ProgItem', ['PID', 'TID', 'ChID', 'StTime', 'Count', 'Flag']);
    }

    private parseChannelItems(xml: string): Map<number, SyoboiChannel> {
        const response = this.getXmlBody(xml, 'ChLookupResponse', 'ChItems');
        if (response.resultCode !== '200') {
            throw new Error(
                `しょぼいカレンダーの局取得に失敗しました (Result Code=${response.resultCode ?? 'missing'})`,
            );
        }
        const channels = new Map<number, SyoboiChannel>();
        for (const row of this.parseItems(response.body, 'ChItem', ['ChID', 'ChName', 'ChGID'])) {
            const id = this.parsePositiveInteger(row.ChID);
            const group = this.parseInteger(row.ChGID);
            const name = row.ChName?.trim();
            if (id === undefined || group === undefined || !name || ![1, 2, 6].includes(group)) continue;
            channels.set(id, { name, group });
        }
        return channels;
    }

    private getXmlBody(xml: string, rootName: string, itemsName: string): { body: string; resultCode: string } {
        if (typeof xml !== 'string') throw new Error('しょぼいカレンダーのXML応答が文字列ではありません');
        const source = xml.replace(/<!--[\s\S]*?-->/g, '');
        const rootMatch = new RegExp(
            `^\\s*(?:<\\?xml\\b[^?]*\\?>\\s*)?<${rootName}\\b[^>]*>([\\s\\S]*)<\\/${rootName}\\s*>\\s*$`,
            'i',
        ).exec(source);
        if (rootMatch === null) throw new Error(`しょぼいカレンダーのXML応答のルートが${rootName}ではありません`);
        const rootBody = rootMatch[1];
        const resultMatch = /<Result\b[^>]*>([\s\S]*?)<\/Result\s*>/i.exec(rootBody);
        const resultCode =
            resultMatch === null
                ? undefined
                : /<Code\b[^>]*>\s*([\s\S]*?)\s*<\/Code\s*>/i.exec(resultMatch[1])?.[1]?.trim();
        if (resultMatch === null) throw new Error(`しょぼいカレンダーのXML応答にResult構造がありません`);
        if (resultCode === undefined || resultCode === '') {
            throw new Error(`しょぼいカレンダーのXML応答にResult/Codeがありません`);
        }

        const emptyItems = new RegExp(`<${itemsName}\\b[^>]*/\\s*>`, 'i').exec(rootBody);
        const itemsMatch = new RegExp(`<${itemsName}\\b[^>]*>([\\s\\S]*?)<\\/${itemsName}\\s*>`, 'i').exec(rootBody);
        if (itemsMatch === null && emptyItems === null) {
            throw new Error(`しょぼいカレンダーのXML応答に${itemsName}構造がありません`);
        }
        return { body: itemsMatch?.[1] ?? '', resultCode };
    }

    private parseItems(body: string, tagName: string, fields: string[]): Array<Record<string, string>> {
        const rows: Array<Record<string, string>> = [];
        const tag = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`, 'gi');
        for (const match of body.matchAll(tag)) {
            const attributes: Record<string, string> = {};
            for (const field of fields) {
                const child = new RegExp(`<${field}\\b[^>]*>([\\s\\S]*?)<\\/${field}\\s*>`, 'i').exec(match[1]);
                if (child !== null) attributes[field] = this.decodeXml(child[1].trim());
            }
            rows.push(attributes);
        }
        return rows;
    }

    private decodeXml(value: string): string {
        return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_entity, code: string) => {
            if (code === 'amp') return '&';
            if (code === 'lt') return '<';
            if (code === 'gt') return '>';
            if (code === 'quot') return '"';
            if (code === 'apos') return "'";
            const numeric =
                code[1]?.toLowerCase() === 'x'
                    ? Number.parseInt(code.slice(2), 16)
                    : Number.parseInt(code.slice(1), 10);
            return Number.isFinite(numeric) && numeric >= 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : '';
        });
    }

    private parsePositiveInteger(value: unknown): number | undefined {
        const parsed = this.parseInteger(value);
        return parsed !== undefined && parsed > 0 ? parsed : undefined;
    }

    private parseInteger(value: unknown): number | undefined {
        if (typeof value !== 'string' && typeof value !== 'number') return undefined;
        if (typeof value === 'string' && !/^\d+$/.test(value)) return undefined;
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
    }

    private isSyoboiDate(value: string): boolean {
        return /^\d{8}_\d{6}$/.test(value);
    }

    private toIsoDate(value: string | undefined): string | undefined {
        if (value === undefined) return undefined;
        const match =
            /^(?:([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})|([0-9]{4})([0-9]{2})([0-9]{2})[_T]?([0-9]{2})([0-9]{2})([0-9]{2}))$/.exec(
                value,
            );
        if (match === null) return undefined;
        const [
            ,
            dashedYear,
            dashedMonth,
            dashedDay,
            dashedHour,
            dashedMinute,
            dashedSecond,
            compactYear,
            compactMonth,
            compactDay,
            compactHour,
            compactMinute,
            compactSecond,
        ] = match;
        const year = dashedYear ?? compactYear;
        const month = dashedMonth ?? compactMonth;
        const day = dashedDay ?? compactDay;
        const hour = dashedHour ?? compactHour;
        const minute = dashedMinute ?? compactMinute;
        const second = dashedSecond ?? compactSecond;
        const date = new Date(
            Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
        );
        if (
            date.getUTCFullYear() !== Number(year) ||
            date.getUTCMonth() !== Number(month) - 1 ||
            date.getUTCDate() !== Number(day) ||
            date.getUTCHours() !== Number(hour) ||
            date.getUTCMinutes() !== Number(minute) ||
            date.getUTCSeconds() !== Number(second)
        )
            return undefined;
        return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
    }
}
