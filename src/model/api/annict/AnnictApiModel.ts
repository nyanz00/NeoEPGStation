import axios from 'axios';
import { inject, injectable } from 'inversify';
import * as fs from 'fs';
import * as path from 'path';
import * as apid from '../../../../api';
import AnnictEpisodeWatch from '../../../db/entities/AnnictEpisodeWatch';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IAnnictEpisodeDB from '../../db/IAnnictEpisodeDB';
import IAnnictRuleLinkDB, { LegacyAnnictRuleLink } from '../../db/IAnnictRuleLinkDB';
import IChannelDB from '../../db/IChannelDB';
import IRecordedDB from '../../db/IRecordedDB';
import IReserveDB from '../../db/IReserveDB';
import IRuleDB from '../../db/IRuleDB';
import IViewerProfileDB from '../../db/IViewerProfileDB';
import IChannelApiModel from '../channel/IChannelApiModel';
import { RuleApiModelProvider } from '../rule/IRuleApiModel';
import IViewerProfileApiModel from '../viewerProfile/IViewerProfileApiModel';
import IAnnictApiModel from './IAnnictApiModel';

interface TokenFile {
    accessToken: string;
}
interface RuleLink {
    annictId: number;
    viewerProfileId?: number;
}
interface RuleLinksFile {
    [ruleId: string]: number | RuleLink;
}
interface CacheFile<T> {
    cachedAt: number;
    value: T;
}

interface AnnictProgramPage {
    nodes: any[];
    hasNextPage: boolean;
    endCursor?: string;
}

interface RecordedProgramCandidate {
    annictId: number;
    startedAt: string;
    channel: {
        name: string;
    };
    episode?: {
        annictId?: number;
        number?: number;
        numberText?: string;
        title?: string;
    } | null;
}

interface RecordedEpisodeCandidate {
    annictId: number;
    number?: number;
    numberText?: string;
    title?: string;
}

const EPISODE_KANJI_DIGITS: Record<string, number> = {
    〇: 0,
    零: 0,
    一: 1,
    壱: 1,
    壹: 1,
    二: 2,
    弐: 2,
    貳: 2,
    三: 3,
    参: 3,
    參: 3,
    四: 4,
    肆: 4,
    五: 5,
    伍: 5,
    六: 6,
    陸: 6,
    七: 7,
    漆: 7,
    柒: 7,
    八: 8,
    捌: 8,
    九: 9,
    玖: 9,
};

const EPISODE_KANJI_UNITS: Record<string, number> = {
    十: 10,
    拾: 10,
    什: 10,
    百: 100,
    佰: 100,
    陌: 100,
    千: 1000,
    仟: 1000,
    阡: 1000,
};

const EPISODE_NUMBER_CHARS = '0-9〇零一壱壹二弐貳三参參四肆五伍六陸七漆柒八捌九玖十拾什百佰陌千仟阡廿卅丗';

interface AnnictPageMetadata {
    imageUrl?: string;
    synopsis?: string;
    synopsisSource?: string;
}

interface AnnictRestWorkDetail {
    imageUrl?: string;
    releasedOn?: string;
    releasedOnAbout?: string;
}

interface SyoboiRerunProgram {
    count: number;
    startedAt: string;
    channelName: string;
}

interface SyoboiRerunCandidate {
    tid: number;
    title: string;
    programs: SyoboiRerunProgram[];
}

// Annict uses official broadcaster names while Mirakurun generally exposes the on-air service name.
// Keep this table limited to known branding differences; broad fuzzy matching can select a different station.
const CHANNEL_NAME_ALIASES: Record<string, string> = {
    日本テレビ: '日テレ',
    TBSテレビ: 'TBS',
    テレビ東京: 'テレ東',
    BSテレビ東京: 'BSテレ東',
    北海道放送: 'HBC',
    札幌テレビ放送: '札幌テレビ',
    北海道テレビ: 'HTB',
    北海道テレビ放送: 'HTB',
    テレビ北海道: 'TVH',
    東北放送: 'TBCテレビ',
    IBC岩手放送: 'IBCテレビ',
    新潟放送: 'BSN',
    テレビ新潟放送網: 'TENY',
    静岡放送: 'SBS',
    CBCテレビ: 'CBC',
    中部日本放送: 'CBC',
    名古屋テレビ: 'メ~テレ',
    名古屋テレビ放送: 'メ~テレ',
    毎日放送: 'MBS',
    MBS毎日放送: 'MBS',
    関西テレビ放送: '関西テレビ',
    読売テレビ放送: '読売テレビ',
    讀賣テレビ放送: '読売テレビ',
    山陽放送: 'RSKテレビ',
    テレビせとうち: 'TSCテレビせとうち',
    中国放送: 'RCCテレビ',
    山陰放送: 'BSSテレビ',
    テレビ山口: 'TYSテレビ',
    九州朝日放送: 'KBCテレビ',
    福岡放送: 'FBS福岡放送',
    BS11イレブン: 'BS11',
};

@injectable()
class AnnictApiModel implements IAnnictApiModel {
    private readonly root = path.join(__dirname, '..', '..', '..', '..', 'data', 'annict');
    private readonly channelApiModel: IChannelApiModel;
    private readonly log: ILogger;
    private legacyRuleLinksImport?: Promise<void>;
    private legacyRuleLinksImported = false;
    private readonly episodeMatchRequests = new Map<number, Promise<void>>();
    private readonly episodeWatchRequests = new Map<string, Promise<void>>();
    private readonly episodeStatusSyncRequests = new Map<string, Promise<void>>();
    private readonly episodeCompletionRequests = new Map<string, Promise<void>>();

    constructor(
        @inject('IChannelApiModel') channelApiModel: IChannelApiModel,
        @inject('IViewerProfileApiModel') private viewerProfileApiModel: IViewerProfileApiModel,
        @inject('IAnnictRuleLinkDB') private annictRuleLinkDB: IAnnictRuleLinkDB,
        @inject('IAnnictEpisodeDB') private annictEpisodeDB: IAnnictEpisodeDB,
        @inject('IRecordedDB') private recordedDB: IRecordedDB,
        @inject('IReserveDB') private reserveDB: IReserveDB,
        @inject('IChannelDB') private channelDB: IChannelDB,
        @inject('IRuleDB') private ruleDB: IRuleDB,
        @inject('RuleApiModelProvider') private ruleApiModelProvider: RuleApiModelProvider,
        @inject('IViewerProfileDB') private viewerProfileDB: IViewerProfileDB,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.channelApiModel = channelApiModel;
        this.log = logger.getLogger();
    }

    public async getStatus(viewerProfileId?: apid.ViewerProfileId): Promise<apid.AnnictStatus> {
        const [configured, writeConfigured] = await Promise.all([
            this.readToken(),
            viewerProfileId === undefined ? Promise.resolve(null) : this.readWriteToken(viewerProfileId),
        ]);
        return { configured: configured !== null, writeConfigured: writeConfigured !== null, viewerProfileId };
    }

    public async setToken(accessToken: string): Promise<void> {
        const token = accessToken.trim();
        if (token.length === 0) throw new Error('Annictアクセストークンを入力してください');
        await this.request(token, 'query { searchWorks(first: 1) { nodes { annictId } } }', {});
        await this.writeJson(path.join(this.root, 'settings.json'), { accessToken: token });
    }

    public async deleteToken(): Promise<void> {
        await fs.promises.rm(path.join(this.root, 'settings.json'), { force: true });
    }

    public async setWriteToken(accessToken: string, viewerProfileId: apid.ViewerProfileId): Promise<void> {
        this.assertViewerProfileId(viewerProfileId);
        const token = accessToken.trim();
        if (token.length === 0) throw new Error('Annict書き込みアクセストークンを入力してください');
        await this.requestRestWithToken(token, 'me', {});
        await this.viewerProfileApiModel.setCredential(viewerProfileId, 'annict', token);
    }

    public async deleteWriteToken(viewerProfileId: apid.ViewerProfileId): Promise<void> {
        this.assertViewerProfileId(viewerProfileId);
        await this.viewerProfileApiModel.deleteCredential(viewerProfileId, 'annict');
    }

    public async getViewerStatuses(
        annictIds: number[],
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<apid.AnnictViewerStatuses> {
        this.assertViewerProfileId(viewerProfileId);
        const ids = this.validAnnictIds(annictIds);
        const statuses: apid.AnnictViewerStatus[] = [];
        for (let index = 0; index < ids.length; index += 50) {
            const data = await this.requestWriteRest(
                'me/works',
                {
                    filter_ids: ids.slice(index, index + 50).join(','),
                    per_page: 50,
                },
                viewerProfileId,
            );
            for (const work of Array.isArray(data?.works) ? data.works : []) {
                const annictId = Number(work?.id);
                const kind = work?.status?.kind;
                if (Number.isInteger(annictId) && this.isViewerStatusKind(kind)) statuses.push({ annictId, kind });
            }
        }
        return { statuses };
    }

    public async setViewerStatus(
        annictId: number,
        kind: apid.AnnictViewerStatusKind,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<void> {
        this.assertViewerProfileId(viewerProfileId);
        if (!Number.isInteger(annictId) || annictId <= 0) throw new Error('Annict作品IDが不正です');
        if (!this.isViewerStatusKind(kind)) throw new Error('Annict視聴ステータスが不正です');
        const token = await this.readWriteToken(viewerProfileId);
        if (token === null) throw new Error('Annict書き込み連携が設定されていません');
        await axios.post(
            'https://api.annict.com/v1/me/statuses',
            new URLSearchParams({ work_id: String(annictId), kind }),
            {
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 20_000,
            },
        );
    }

    public async setViewerStatuses(
        annictIds: number[],
        kind: apid.AnnictViewerStatusKind,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<void> {
        this.assertViewerProfileId(viewerProfileId);
        const ids = this.validAnnictIds(annictIds);
        for (let index = 0; index < ids.length; index += 4) {
            await Promise.all(
                ids.slice(index, index + 4).map(annictId => this.setViewerStatus(annictId, kind, viewerProfileId)),
            );
        }
    }

    public async linkRule(
        ruleId: apid.RuleId,
        annictId: number,
        viewerProfileId?: apid.ViewerProfileId,
    ): Promise<void> {
        if (!Number.isInteger(ruleId) || ruleId <= 0) throw new Error('ルールIDが不正です');
        if (!Number.isInteger(annictId) || annictId <= 0) throw new Error('Annict作品IDが不正です');
        await this.ensureLegacyRuleLinksImported();
        await this.annictRuleLinkDB.upsert(ruleId, annictId, viewerProfileId);
        if (viewerProfileId === undefined) return;
        const current = (await this.getViewerStatuses([annictId], viewerProfileId)).statuses.find(
            status => status.annictId === annictId,
        );
        if (current?.kind === 'watched' || current?.kind === 'watching') return;
        await this.setViewerStatus(annictId, 'watching', viewerProfileId);
    }

    public async syncEnabledRule(ruleId: apid.RuleId): Promise<void> {
        try {
            await this.ensureLegacyRuleLinksImported();
            const link = await this.annictRuleLinkDB.findRuleId(ruleId);
            if (link === null) return;
            if (link.viewerProfileId === null || link.viewerProfileId === undefined) return;
            const viewerProfileId = link.viewerProfileId;
            const current = (await this.getViewerStatuses([link.annictId], viewerProfileId)).statuses.find(
                status => status.annictId === link.annictId,
            );
            if (current?.kind === 'watched' || current?.kind === 'watching') return;
            await this.setViewerStatus(link.annictId, 'watching', viewerProfileId);
        } catch (err) {
            this.log.system.warn(`Annict rule enable sync failed: ruleId=${ruleId}, error=${this.errorMessage(err)}`);
        }
    }

    public async syncDisabledRule(ruleId: apid.RuleId): Promise<void> {
        try {
            await this.ensureLegacyRuleLinksImported();
            const link = await this.annictRuleLinkDB.findRuleId(ruleId);
            if (link === null) return;
            if (link.viewerProfileId === null || link.viewerProfileId === undefined) return;
            if (await this.hasAnotherEnabledLinkedRule(link.annictId, link.viewerProfileId, ruleId)) return;
            const viewerProfileId = link.viewerProfileId;
            const current = (await this.getViewerStatuses([link.annictId], viewerProfileId)).statuses.find(
                status => status.annictId === link.annictId,
            );
            if (current?.kind === 'watched') return;
            await this.setViewerStatus(link.annictId, 'stop_watching', viewerProfileId);
        } catch (err) {
            this.log.system.warn(`Annict rule disable sync failed: ruleId=${ruleId}, error=${this.errorMessage(err)}`);
        }
    }

    public async unlinkRule(ruleId: apid.RuleId): Promise<void> {
        try {
            await this.ensureLegacyRuleLinksImported();
            await this.annictRuleLinkDB.deleteRuleId(ruleId);
        } catch (err) {
            this.log.system.warn(`Annict rule unlink failed: ruleId=${ruleId}, error=${this.errorMessage(err)}`);
        }
    }

    public async getRecordedEpisode(
        recordedId: apid.RecordedId,
        viewerProfileId?: apid.ViewerProfileId,
        force = false,
    ): Promise<apid.AnnictRecordedEpisodeInfo> {
        if (!Number.isInteger(recordedId) || recordedId <= 0) throw new Error('録画IDが不正です');
        let mapping = await this.annictEpisodeDB.findRecorded(recordedId);
        const retryAfter = 6 * 60 * 60 * 1000;
        const shouldMatch =
            force ||
            mapping === null ||
            (mapping.status === 'pending' &&
                (mapping.lastCheckedAt === null ||
                    mapping.lastCheckedAt === undefined ||
                    Date.now() - mapping.lastCheckedAt >= retryAfter));
        if (shouldMatch) {
            await this.matchRecordedEpisode(recordedId, force).catch(err => {
                this.log.system.warn(
                    `Annict recorded episode match failed: recordedId=${recordedId}, error=${this.errorMessage(err)}`,
                );
            });
            mapping = await this.annictEpisodeDB.findRecorded(recordedId);
        }

        const writeConfigured = viewerProfileId !== undefined && (await this.readWriteToken(viewerProfileId)) !== null;
        if (mapping === null) {
            return {
                state: 'unlinked',
                viewerProfileId,
                writeConfigured,
                watched: false,
                canUnwatch: false,
            };
        }
        const episodeAnnictId = mapping.episodeAnnictId ?? undefined;
        const watch =
            viewerProfileId === undefined || episodeAnnictId === undefined
                ? null
                : await this.annictEpisodeDB.findWatch(episodeAnnictId, viewerProfileId);
        if (
            watch?.status === 'watched' &&
            watch.statusSyncPending &&
            episodeAnnictId !== undefined &&
            viewerProfileId !== undefined
        ) {
            void this.syncPendingEpisodeWatchStatus(episodeAnnictId, viewerProfileId).catch(err => {
                this.log.system.warn(
                    `Annict pending viewer status sync failed: episodeAnnictId=${episodeAnnictId}, viewerProfileId=${viewerProfileId}, error=${this.errorMessage(err)}`,
                );
            });
        }
        if (
            watch?.status === 'watched' &&
            (watch.completionPending || watch.ruleDisablePending) &&
            episodeAnnictId !== undefined &&
            viewerProfileId !== undefined
        ) {
            void this.syncPendingEpisodeCompletion(recordedId, episodeAnnictId, viewerProfileId).catch(err => {
                this.log.system.warn(
                    `Annict pending episode completion failed: recordedId=${recordedId}, ` +
                        `viewerProfileId=${viewerProfileId}, error=${this.errorMessage(err)}`,
                );
            });
        }
        return {
            state: mapping.status === 'matched' && episodeAnnictId !== undefined ? 'matched' : 'pending',
            annictId: mapping.annictId,
            programAnnictId: mapping.programAnnictId ?? undefined,
            episodeAnnictId,
            episodeNumber: mapping.episodeNumber ?? undefined,
            episodeNumberText: mapping.episodeNumberText ?? undefined,
            episodeTitle: mapping.episodeTitle ?? undefined,
            pendingReason: this.isRecordedEpisodePendingReason(mapping.pendingReason)
                ? mapping.pendingReason
                : undefined,
            lastCheckedAt: mapping.lastCheckedAt ?? undefined,
            viewerProfileId,
            writeConfigured,
            watched: watch?.status === 'watched',
            canUnwatch:
                watch?.status === 'watched' && watch.annictRecordId !== null && watch.annictRecordId !== undefined,
        };
    }

    public async matchRecordedEpisode(recordedId: apid.RecordedId, force = false): Promise<void> {
        const currentRequest = this.episodeMatchRequests.get(recordedId);
        if (currentRequest !== undefined) {
            await currentRequest;
            return;
        }
        const request = this.matchRecordedEpisodeOnce(recordedId, force).finally(() => {
            this.episodeMatchRequests.delete(recordedId);
        });
        this.episodeMatchRequests.set(recordedId, request);
        await request;
    }

    private async matchRecordedEpisodeOnce(recordedId: apid.RecordedId, force: boolean): Promise<void> {
        if (!Number.isInteger(recordedId) || recordedId <= 0) throw new Error('録画IDが不正です');
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null) throw new Error('録画番組が見つかりません');
        if (recorded.ruleId === null || recorded.ruleId === undefined) return;
        await this.ensureLegacyRuleLinksImported();
        const ruleLink = await this.annictRuleLinkDB.findRuleId(recorded.ruleId);
        if (ruleLink === null) return;

        const mapping = await this.annictEpisodeDB.upsertPending(recordedId, ruleLink.annictId);
        if (!force && mapping.status === 'matched' && mapping.episodeAnnictId !== null) return;
        const preserveExistingMatch = mapping.status === 'matched' && mapping.episodeAnnictId !== null;
        const setPending = async (reason: apid.AnnictRecordedEpisodePendingReason, checkedAt: number) => {
            if (!preserveExistingMatch) await this.annictEpisodeDB.setPending(recordedId, reason, checkedAt);
        };
        const checkedAt = Date.now();
        const channel = await this.channelDB.findId(recorded.channelId);
        if (channel === null) {
            await setPending('program_not_found', checkedAt);
            return;
        }

        let programs: RecordedProgramCandidate[];
        try {
            programs = await this.requestRecordedProgramCandidates(ruleLink.annictId, recorded.startAt);
        } catch (err) {
            await setPending('annict_unavailable', checkedAt);
            throw err;
        }
        const strictTolerance = 15 * 60 * 1000;
        const expandedTolerance = 6 * 60 * 60 * 1000;
        const stationPrograms = programs.filter(program =>
            [channel.name, channel.halfWidthName].some(name =>
                typeof name === 'string' ? this.channelNamesMatch(program.channel.name, name) : false,
            ),
        );
        const strictCandidates = stationPrograms.filter(program => {
            const startedAt = Date.parse(program.startedAt);
            return Number.isFinite(startedAt) && Math.abs(startedAt - recorded.startAt) <= strictTolerance;
        });
        const strictProgram = this.singleRecordedProgram(strictCandidates);
        if (strictProgram !== undefined && this.hasRecordedProgramEpisode(strictProgram)) {
            await this.setRecordedProgramMatched(recordedId, strictProgram, checkedAt);
            return;
        }

        const expandedCandidates = stationPrograms.filter(program => {
            const startedAt = Date.parse(program.startedAt);
            return Number.isFinite(startedAt) && Math.abs(startedAt - recorded.startAt) <= expandedTolerance;
        });
        const expandedProgram = this.singleRecordedProgram(expandedCandidates);
        if (expandedProgram !== undefined && this.hasRecordedProgramEpisode(expandedProgram)) {
            await this.setRecordedProgramMatched(recordedId, expandedProgram, checkedAt);
            return;
        }

        const episodeNumbers = this.extractExplicitEpisodeNumbers(recorded.name);
        if (episodeNumbers.length !== 1) {
            const hasAmbiguousPrograms = strictCandidates.length > 1 || expandedCandidates.length > 1;
            const hasProgramWithoutEpisode = strictProgram !== undefined || expandedProgram !== undefined;
            await setPending(
                hasAmbiguousPrograms
                    ? 'program_ambiguous'
                    : hasProgramWithoutEpisode
                      ? 'episode_unavailable'
                      : 'program_not_found',
                checkedAt,
            );
            return;
        }

        let episodes: RecordedEpisodeCandidate[];
        try {
            episodes = await this.requestRecordedEpisodeCandidates(ruleLink.annictId);
        } catch (err) {
            await setPending('annict_unavailable', checkedAt);
            throw err;
        }
        const episodeNumber = episodeNumbers[0];
        const episodeCandidates = episodes.filter(episode => this.recordedEpisodeNumberMatches(episode, episodeNumber));
        const uniqueEpisodes = Array.from(
            new Map(episodeCandidates.map(episode => [episode.annictId, episode])).values(),
        );
        if (uniqueEpisodes.length !== 1) {
            await setPending(uniqueEpisodes.length === 0 ? 'episode_unavailable' : 'program_ambiguous', checkedAt);
            return;
        }

        const episode = uniqueEpisodes[0];
        const matchingProgram = this.singleRecordedProgram(
            stationPrograms.filter(program => program.episode?.annictId === episode.annictId),
        );
        await this.annictEpisodeDB.setMatched(
            recordedId,
            {
                programAnnictId: matchingProgram?.annictId,
                episodeAnnictId: episode.annictId,
                episodeNumber: episode.number,
                episodeNumberText: episode.numberText,
                episodeTitle: episode.title,
            },
            checkedAt,
        );
    }

    public async markRecordedEpisodeWatched(
        recordedId: apid.RecordedId,
        viewerProfileId: apid.ViewerProfileId,
        option: apid.AnnictEpisodeWatchOption,
    ): Promise<apid.AnnictRecordedEpisodeInfo> {
        if (!Number.isInteger(viewerProfileId) || viewerProfileId <= 0) {
            throw new Error('視聴者プロフィールIDが不正です');
        }
        const info = await this.getRecordedEpisode(recordedId, viewerProfileId);
        if (info.state !== 'matched' || info.episodeAnnictId === undefined) {
            throw new Error('Annictエピソードとの対応が確定していません');
        }
        if (info.annictId === undefined) throw new Error('Annict作品IDが保存されていません');
        if (!info.writeConfigured) throw new Error('Annict書き込み連携が設定されていません');
        if (
            typeof option?.markWorkWatchedOnFinalEpisode !== 'boolean' ||
            typeof option?.disableRulesOnFinalEpisode !== 'boolean'
        ) {
            throw new Error('最終話視聴後の処理設定が不正です');
        }
        const key = `${info.episodeAnnictId}:${viewerProfileId}`;
        const currentRequest = this.episodeWatchRequests.get(key);
        if (currentRequest !== undefined) {
            await currentRequest;
        } else {
            const request = this.markEpisodeWatchedOnce(info.episodeAnnictId, viewerProfileId).finally(() => {
                this.episodeWatchRequests.delete(key);
            });
            this.episodeWatchRequests.set(key, request);
            await request;
        }
        if (option.markWorkWatchedOnFinalEpisode) {
            const recorded = await this.recordedDB.findId(recordedId);
            const explicitFinalEpisode =
                recorded !== null &&
                this.hasExplicitFinalEpisodeMarker(
                    [recorded.name, recorded.description ?? '', recorded.extended ?? ''].join(' '),
                );
            await this.annictEpisodeDB.setCompletionPending(
                info.episodeAnnictId,
                viewerProfileId,
                info.annictId,
                option.disableRulesOnFinalEpisode,
                explicitFinalEpisode,
            );
            void this.syncPendingEpisodeCompletion(recordedId, info.episodeAnnictId, viewerProfileId).catch(err => {
                this.log.system.warn(
                    `Annict episode completion failed: recordedId=${recordedId}, viewerProfileId=${viewerProfileId}, ` +
                        `error=${this.errorMessage(err)}`,
                );
            });
        }
        return this.getRecordedEpisode(recordedId, viewerProfileId);
    }

    public async unmarkRecordedEpisodeWatched(
        recordedId: apid.RecordedId,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<apid.AnnictRecordedEpisodeInfo> {
        if (!Number.isInteger(viewerProfileId) || viewerProfileId <= 0) {
            throw new Error('視聴者プロフィールIDが不正です');
        }
        const info = await this.getRecordedEpisode(recordedId, viewerProfileId);
        if (info.state !== 'matched' || info.episodeAnnictId === undefined) {
            throw new Error('Annictエピソードとの対応が確定していません');
        }
        if (!info.writeConfigured) throw new Error('Annict書き込み連携が設定されていません');

        const token = await this.readWriteToken(viewerProfileId);
        if (token === null) throw new Error('Annict書き込み連携が設定されていません');
        const watch = await this.annictEpisodeDB.findWatch(info.episodeAnnictId, viewerProfileId);
        const annictRecordId = watch?.annictRecordId ?? null;
        if (annictRecordId === null) {
            throw new Error('EPGStationが作成した記録ではないため、安全のためAnnict側で削除してください');
        }
        await axios.delete(`https://api.annict.com/v1/me/records/${annictRecordId.toString(10)}`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 20_000,
        });
        await this.annictEpisodeDB.setUnwatched(info.episodeAnnictId, viewerProfileId);
        return this.getRecordedEpisode(recordedId, viewerProfileId);
    }

    public async retryPendingEpisodeSyncs(): Promise<void> {
        const watches = await this.annictEpisodeDB.findPendingWatches(50, Date.now());
        for (const watch of watches) {
            if (watch.statusSyncPending) {
                try {
                    await this.syncPendingEpisodeWatchStatus(watch.episodeAnnictId, watch.viewerProfileId);
                } catch (err) {
                    this.log.system.warn(
                        `Annict queued viewer status sync failed: episodeAnnictId=${watch.episodeAnnictId}, ` +
                            `viewerProfileId=${watch.viewerProfileId}, error=${this.errorMessage(err)}`,
                    );
                    continue;
                }
            }
            if (!watch.completionPending && !watch.ruleDisablePending) continue;
            const mapping = await this.annictEpisodeDB.findRecordedByEpisode(watch.episodeAnnictId);
            if (mapping === null) {
                try {
                    await this.syncPendingEpisodeCompletionWithoutRecorded(watch);
                } catch (err) {
                    await this.annictEpisodeDB
                        .scheduleWatchRetry(watch.episodeAnnictId, watch.viewerProfileId, this.errorMessage(err))
                        .catch(() => {});
                    this.log.system.warn(
                        `Annict queued episode completion without recording failed: ` +
                            `episodeAnnictId=${watch.episodeAnnictId}, viewerProfileId=${watch.viewerProfileId}, ` +
                            `error=${this.errorMessage(err)}`,
                    );
                }
                continue;
            }
            try {
                await this.syncPendingEpisodeCompletion(
                    mapping.recordedId,
                    watch.episodeAnnictId,
                    watch.viewerProfileId,
                );
            } catch (err) {
                this.log.system.warn(
                    `Annict queued episode completion failed: recordedId=${mapping.recordedId}, ` +
                        `viewerProfileId=${watch.viewerProfileId}, error=${this.errorMessage(err)}`,
                );
            }
        }
    }

    private async syncPendingEpisodeCompletionWithoutRecorded(watch: AnnictEpisodeWatch): Promise<void> {
        const key = `${watch.episodeAnnictId}:${watch.viewerProfileId}`;
        const currentRequest = this.episodeCompletionRequests.get(key);
        if (currentRequest !== undefined) {
            await currentRequest;
            return;
        }
        const request = this.syncPendingEpisodeCompletionWithoutRecordedOnce(watch).finally(() => {
            this.episodeCompletionRequests.delete(key);
        });
        this.episodeCompletionRequests.set(key, request);
        await request;
    }

    private async syncPendingEpisodeCompletionWithoutRecordedOnce(watch: AnnictEpisodeWatch): Promise<void> {
        if (watch.status !== 'watched' || (!watch.completionPending && !watch.ruleDisablePending)) return;
        const workAnnictId = watch.workAnnictId ?? null;
        if (workAnnictId === null || !Number.isInteger(workAnnictId) || workAnnictId <= 0) {
            throw new Error('Annict作品IDが保存されていません');
        }

        const token = await this.readWriteToken(watch.viewerProfileId);
        if (token === null) throw new Error('Annict書き込み連携が設定されていません');

        let annictHasNoNextEpisode: boolean | undefined;
        let annictConfirmsFinalEpisode = false;
        if (!watch.explicitFinalEpisode || watch.ruleDisablePending) {
            try {
                const data = await this.request(
                    token,
                    `query EpisodeCompletion($annictIds: [Int!]) {
                        searchEpisodes(annictIds: $annictIds, first: 1) {
                            nodes {
                                annictId
                                number
                                nextEpisode { annictId }
                                work { annictId episodesCount }
                            }
                        }
                    }`,
                    { annictIds: [watch.episodeAnnictId] },
                    true,
                );
                const episode = Array.isArray(data?.searchEpisodes?.nodes)
                    ? data.searchEpisodes.nodes.find((value: any) => Number(value?.annictId) === watch.episodeAnnictId)
                    : undefined;
                if (episode !== undefined && episode.nextEpisode !== undefined) {
                    const episodeWorkAnnictId = Number(episode.work?.annictId);
                    const episodeNumber = Number(episode.number);
                    const episodesCount = Number(episode.work?.episodesCount);
                    if (!Number.isInteger(episodeWorkAnnictId) || episodeWorkAnnictId !== workAnnictId) {
                        throw new Error('Annictエピソードの作品IDが視聴記録と一致しません');
                    }
                    annictHasNoNextEpisode = episode.nextEpisode === null;
                    annictConfirmsFinalEpisode =
                        annictHasNoNextEpisode &&
                        Number.isInteger(episodeNumber) &&
                        episodeNumber > 0 &&
                        Number.isInteger(episodesCount) &&
                        episodesCount > 0 &&
                        episodeNumber === episodesCount;
                }
            } catch (err) {
                if (!watch.explicitFinalEpisode) throw err;
                this.log.system.warn(
                    `Annict final episode confirmation without recording failed: ` +
                        `episodeAnnictId=${watch.episodeAnnictId}, error=${this.errorMessage(err)}`,
                );
            }
        }

        if (!watch.explicitFinalEpisode && !annictConfirmsFinalEpisode) {
            if (annictHasNoNextEpisode === false) {
                await this.annictEpisodeDB.clearCompletionPending(watch.episodeAnnictId, watch.viewerProfileId);
            } else {
                await this.annictEpisodeDB.scheduleWatchRetry(
                    watch.episodeAnnictId,
                    watch.viewerProfileId,
                    'Annictの最終話情報がまだ確定していません',
                );
            }
            return;
        }

        if (watch.completionPending) {
            const current = (await this.getViewerStatuses([workAnnictId], watch.viewerProfileId)).statuses.find(
                status => status.annictId === workAnnictId,
            )?.kind;
            if (current !== 'watched') {
                await this.setViewerStatus(workAnnictId, 'watched', watch.viewerProfileId);
            }
            await this.annictEpisodeDB.clearWorkCompletionPending(watch.episodeAnnictId, watch.viewerProfileId);
        }

        if (!watch.ruleDisablePending) return;
        if (annictHasNoNextEpisode === false) {
            await this.annictEpisodeDB.clearRuleDisablePending(watch.episodeAnnictId, watch.viewerProfileId);
            return;
        }
        if (annictHasNoNextEpisode !== true) {
            await this.annictEpisodeDB.scheduleWatchRetry(
                watch.episodeAnnictId,
                watch.viewerProfileId,
                'Annictに次話がないことをまだ確認できません',
            );
            return;
        }
        await this.disableCompletedWorkRules(workAnnictId, watch.episodeAnnictId, watch.viewerProfileId);
    }

    private async disableCompletedWorkRules(
        workAnnictId: number,
        episodeAnnictId: number,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<void> {
        const profile = await this.viewerProfileDB.findId(viewerProfileId);
        if (profile?.tvUserId === null || profile?.tvUserId === undefined) {
            throw new Error('視聴者プロフィールにEPGStationユーザーが紐づいていません');
        }
        const links = await this.annictRuleLinkDB.findWork(workAnnictId, viewerProfileId);
        const ruleApiModel = await this.ruleApiModelProvider();
        let hasRemainingReservations = false;
        for (const link of links) {
            const rule = await ruleApiModel.get(link.ruleId);
            if (rule !== null && rule.userId === profile.tvUserId && rule.reserveOption.enable) {
                const reserves = await this.reserveDB.findRuleId({
                    ruleId: rule.id,
                    hasSkip: true,
                    hasConflict: true,
                    hasOverlap: true,
                    hasEventRelay: true,
                });
                if (reserves.length > 0) {
                    hasRemainingReservations = true;
                    continue;
                }
                await ruleApiModel.disable(rule.id);
            }
        }
        if (!hasRemainingReservations) {
            await this.annictEpisodeDB.clearRuleDisablePending(episodeAnnictId, viewerProfileId);
        } else {
            await this.annictEpisodeDB.scheduleWatchRetry(
                episodeAnnictId,
                viewerProfileId,
                '対象ルールに未完了の予約が残っています',
            );
        }
    }

    public async getWorks(season: string, refresh: boolean, rerun = false): Promise<apid.AnnictWorkList> {
        if (!/^\d{4}-(winter|spring|summer|autumn)$/.test(season)) throw new Error('seasonが不正です');
        if (rerun) return this.getRerunWorks(season, refresh);
        const file = path.join(this.root, 'cache', `works-v10-${season}.json`);
        const cached = await this.readCache<apid.AnnictWorkSummary[]>(file);
        if (!refresh && cached !== null && Date.now() - cached.cachedAt < 24 * 60 * 60 * 1000) {
            return { season, works: cached.value, cachedAt: cached.cachedAt, stale: false };
        }
        try {
            const data = await this.requestWithSavedToken(
                `query Works($season: [String!]) {
                    searchWorks(seasons: $season, first: 100, orderBy: { field: WATCHERS_COUNT, direction: DESC }) {
                        nodes {
                            annictId title titleKana seasonName seasonYear media watchersCount malAnimeId
                            image {
                                recommendedImageUrl facebookOgImageUrl twitterAvatarUrl
                                twitterBiggerAvatarUrl twitterNormalAvatarUrl twitterMiniAvatarUrl
                            }
                            programs(first: 1, orderBy: { field: STARTED_AT, direction: ASC }) {
                                nodes { startedAt }
                            }
                        }
                    }
                }`,
                { season: [season] },
            );
            const nodes = Array.isArray(data.searchWorks?.nodes) ? data.searchWorks.nodes : [];
            const works = await this.enrichWorkReleaseDates(
                await this.fillMissingWorkImages(
                    nodes
                        .filter(
                            (work: any) => work !== null && typeof work === 'object' && Number.isFinite(work.annictId),
                        )
                        .map(this.mapWork),
                ),
            );
            const cachedAt = Date.now();
            await this.writeJson(file, { cachedAt, value: works });
            return { season, works, cachedAt, stale: false };
        } catch (err) {
            if (cached !== null) return { season, works: cached.value, cachedAt: cached.cachedAt, stale: true };
            throw err;
        }
    }

    public async getWork(annictId: number, refresh: boolean): Promise<apid.AnnictWorkDetail> {
        const file = path.join(this.root, 'cache', `work-v16-${annictId}.json`);
        const cached = await this.readCache<Omit<apid.AnnictWorkDetail, 'cachedAt' | 'stale'>>(file);
        if (!refresh && cached !== null && Date.now() - cached.cachedAt < 6 * 60 * 60 * 1000) {
            return {
                ...(await this.addSyoboiProgramFallback(annictId, cached.value)),
                cachedAt: cached.cachedAt,
                stale: false,
            };
        }
        try {
            const data = await this.requestWithSavedToken(
                `query Work($annictId: [Int!]) {
                    searchWorks(annictIds: $annictId, first: 1) {
                        nodes {
                            annictId title titleKana titleEn seasonName seasonYear media watchersCount malAnimeId
                            officialSiteUrl officialSiteUrlEn twitterHashtag twitterUsername
                            wikipediaUrl wikipediaUrlEn syobocalTid
                            image {
                                recommendedImageUrl facebookOgImageUrl twitterAvatarUrl
                                twitterBiggerAvatarUrl twitterNormalAvatarUrl twitterMiniAvatarUrl
                            }
                        }
                    }
                }`,
                { annictId: [annictId] },
            );
            const node = Array.isArray(data.searchWorks?.nodes)
                ? data.searchWorks.nodes.find((work: any) => work !== null && typeof work === 'object')
                : undefined;
            if (node === undefined) throw new Error('Annict作品が見つかりません');
            const channels = await this.channelApiModel.getChannels();
            const base = this.mapWork(node);
            const [programResult, restWork, pageMetadata, pageReleasedOn, casts, staffs] = await Promise.all([
                this.getPrograms(annictId, channels, base.seasonYear, base.seasonName),
                this.getRestWorkDetail(annictId),
                this.getAnnictPageMetadata(annictId),
                this.getAnnictInfoPageReleasedOn(annictId),
                this.getRestCasts(annictId),
                this.getRestStaffs(annictId),
            ]);
            const imageUrl =
                (await this.resolveWorkImageUrl([base.imageUrl, restWork?.imageUrl, pageMetadata.imageUrl])) ??
                (base.malAnimeId !== undefined ? await this.getJikanImageUrl(base.malAnimeId) : undefined) ??
                pageMetadata.imageUrl;
            const value: Omit<apid.AnnictWorkDetail, 'cachedAt' | 'stale'> = {
                ...base,
                imageUrl,
                titleEn: this.optionalString(node.titleEn),
                synopsis: pageMetadata.synopsis,
                synopsisSource: pageMetadata.synopsisSource,
                releasedOn: restWork?.releasedOn ?? pageReleasedOn,
                releasedOnAbout: restWork?.releasedOnAbout,
                officialSiteUrl: this.optionalString(node.officialSiteUrl),
                officialSiteUrlEn: this.optionalString(node.officialSiteUrlEn),
                twitterUsername: this.optionalString(node.twitterUsername),
                twitterHashtag: this.optionalString(node.twitterHashtag),
                wikipediaUrl: this.optionalString(node.wikipediaUrl),
                wikipediaUrlEn: this.optionalString(node.wikipediaUrlEn),
                syobocalTid: Number.isFinite(node.syobocalTid) ? node.syobocalTid : undefined,
                casts,
                staffs,
                programs: programResult.programs,
                programsError: programResult.error,
            };
            const cachedAt = Date.now();
            await this.writeJson(file, { cachedAt, value });
            return { ...(await this.addSyoboiProgramFallback(annictId, value)), cachedAt, stale: false };
        } catch (err) {
            if (cached !== null)
                return {
                    ...(await this.addSyoboiProgramFallback(annictId, cached.value)),
                    cachedAt: cached.cachedAt,
                    stale: true,
                };
            throw err;
        }
    }

    private async getRerunWorks(season: string, refresh: boolean): Promise<apid.AnnictWorkList> {
        const file = path.join(this.root, 'cache', `rerun-works-v3-${season}.json`);
        const cached = await this.readCache<apid.AnnictWorkSummary[]>(file);
        if (!refresh && cached !== null && Date.now() - cached.cachedAt < 24 * 60 * 60 * 1000) {
            return { season, works: cached.value, cachedAt: cached.cachedAt, stale: false, rerun: true };
        }
        try {
            const candidates = await this.getSyoboiRerunCandidates(season);
            const matchedCandidates = new Map<number, SyoboiRerunCandidate>();
            for (let index = 0; index < candidates.length; index += 4) {
                const matches = await Promise.all(
                    candidates.slice(index, index + 4).map(async candidate => {
                        try {
                            const data = await this.requestRest('works', {
                                filter_title: candidate.title,
                                per_page: 50,
                            });
                            const works = Array.isArray(data?.works) ? data.works : [];
                            const matched =
                                works.find((work: any) => Number(work?.syobocal_tid) === candidate.tid) ??
                                works.find(
                                    (work: any) =>
                                        this.normalizeTitle(String(work?.title ?? '')) ===
                                        this.normalizeTitle(candidate.title),
                                );
                            return Number.isFinite(matched?.id)
                                ? { annictId: Number(matched.id), candidate }
                                : undefined;
                        } catch (err) {
                            this.log.system.warn(
                                `Annict rerun match failed: title=${candidate.title}, error=${this.errorMessage(err)}`,
                            );
                            return undefined;
                        }
                    }),
                );
                for (const match of matches) {
                    if (match === undefined) continue;
                    const current = matchedCandidates.get(match.annictId);
                    matchedCandidates.set(match.annictId, {
                        ...match.candidate,
                        programs: [...(current?.programs ?? []), ...match.candidate.programs],
                    });
                }
            }
            const uniqueIds = Array.from(matchedCandidates.keys());
            const works: apid.AnnictWorkSummary[] = [];
            for (let index = 0; index < uniqueIds.length; index += 50) {
                const ids = uniqueIds.slice(index, index + 50);
                const data = await this.requestWithSavedToken(
                    `query RerunWorks($ids: [Int!]) {
                        searchWorks(annictIds: $ids, first: 50, orderBy: { field: WATCHERS_COUNT, direction: DESC }) {
                            nodes {
                                annictId title titleKana seasonName seasonYear media watchersCount malAnimeId
                                image { recommendedImageUrl facebookOgImageUrl twitterAvatarUrl twitterBiggerAvatarUrl }
                            }
                        }
                    }`,
                    { ids },
                );
                works.push(
                    ...(Array.isArray(data.searchWorks?.nodes) ? data.searchWorks.nodes : [])
                        .filter(Boolean)
                        .map(this.mapWork),
                );
            }
            const channels = await this.channelApiModel.getChannels();
            const receivableWorks = await this.filterReceivableRerunWorks(works, channels);
            await Promise.all(
                Array.from(matchedCandidates, ([annictId, candidate]) =>
                    this.writeJson(this.syoboiProgramCacheFile(annictId), {
                        cachedAt: Date.now(),
                        value: this.uniqueSyoboiPrograms(candidate.programs),
                    }),
                ),
            );
            const value = await this.enrichWorkReleaseDates(await this.fillMissingWorkImages(receivableWorks));
            const cachedAt = Date.now();
            await this.writeJson(file, { cachedAt, value });
            return { season, works: value, cachedAt, stale: false, rerun: true };
        } catch (err) {
            if (cached !== null)
                return { season, works: cached.value, cachedAt: cached.cachedAt, stale: true, rerun: true };
            throw err;
        }
    }

    private async filterReceivableRerunWorks(
        works: apid.AnnictWorkSummary[],
        channels: apid.ChannelItem[],
    ): Promise<apid.AnnictWorkSummary[]> {
        const accepted = new Set<number>();
        for (let index = 0; index < works.length; index += 50) {
            const batch = works.slice(index, index + 50);
            try {
                const data = await this.requestWithSavedToken(
                    `query RerunProgramStations($ids: [Int!]) {
                        searchWorks(annictIds: $ids, first: 50) {
                            nodes {
                                annictId
                                programs(first: 100, orderBy: { field: STARTED_AT, direction: DESC }) {
                                    nodes { annictId startedAt rebroadcast channel { annictId name } }
                                }
                            }
                        }
                    }`,
                    { ids: batch.map(work => work.annictId) },
                );
                const nodes = Array.isArray(data.searchWorks?.nodes) ? data.searchWorks.nodes : [];
                const found = new Set<number>();
                for (const node of nodes) {
                    if (!Number.isFinite(node?.annictId)) continue;
                    found.add(node.annictId);
                    const programs = Array.isArray(node.programs?.nodes) ? node.programs.nodes.filter(Boolean) : [];
                    // Future titles often have no Program rows yet.  They remain useful rerun
                    // candidates and are searchable by title, so only reject a work when Annict
                    // has station data and every one of those stations is unavailable locally.
                    if (
                        programs.length === 0 ||
                        this.mapPrograms(programs, channels).some(program => program.localChannels.length > 0)
                    )
                        accepted.add(node.annictId);
                }
                batch.forEach(work => {
                    if (!found.has(work.annictId)) accepted.add(work.annictId);
                });
            } catch (err) {
                // A temporary Annict failure must not erase valid Syoboi rerun candidates.
                this.log.system.warn(`Annict rerun station confirmation failed: error=${this.errorMessage(err)}`);
                batch.forEach(work => accepted.add(work.annictId));
            }
        }
        return works.filter(work => accepted.has(work.annictId));
    }

    private async getSyoboiRerunCandidates(season: string): Promise<SyoboiRerunCandidate[]> {
        const [yearText, name] = season.split('-');
        const year = Number(yearText);
        const month: Record<string, number> = { winter: 0, spring: 3, summer: 6, autumn: 9 };
        const start = new Date(Date.UTC(year, month[name], 1));
        start.setUTCDate(start.getUTCDate() - 14);
        const end = new Date(Date.UTC(year, month[name] + 3, 1));
        const items: any[] = [];
        for (const cursor = new Date(start); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 14)) {
            const response = await axios.get('https://cal.syoboi.jp/rss2.php', {
                params: { start: this.syoboiDate(cursor), days: 14, alt: 'json' },
                timeout: 20_000,
            });
            this.collectSyoboiItems(response.data, items);
        }
        const paid =
            /AT[\s-]*X|キッズステーション|アニマックス|ディズニー|WOWOW|スターチャンネル|J[\s:：-]*COM[\s-]*BS|J SPORTS|日本映画専門|時代劇専門|チャンネルNECO|ファミリー劇場|テレ朝チャンネル|TBSチャンネル|フジテレビ(?:ONE|TWO|NEXT)|日テレプラス|ホームドラマ|衛星劇場|東映チャンネル|カートゥーン|GAORA|スカイA/i;
        const grouped = new Map<string, any[]>();
        for (const item of items) {
            const tid = Number(item.TID ?? item.tid);
            const count = Number(item.Count ?? item.count);
            const flag = Number(item.Flag ?? item.flag);
            const category = Number(item.Cat ?? item.cat);
            const channelId = Number(item.ChID ?? item.chid);
            const channelGroup = Number(item.ChGID ?? item.chgid);
            const title = String(item.Title ?? item.title ?? '').trim();
            const channel = String(item.ChName ?? item.chname ?? '').trim();
            const startedAt = Number(item.StTime ?? item.sttime) * 1000;
            if (!Number.isFinite(tid) || !Number.isFinite(count) || !Number.isFinite(startedAt) || title.length === 0)
                continue;
            if (category !== 10 || (flag & 8) === 0 || ![1, 2, 6].includes(channelGroup) || paid.test(channel))
                continue;
            const key = `${tid}:${channelId}`;
            const group = grouped.get(key) ?? [];
            group.push({ tid, title, count, startedAt, channelName: channel });
            grouped.set(key, group);
        }
        const result = new Map<number, SyoboiRerunCandidate>();
        for (const group of grouped.values()) {
            group.sort((a, b) => a.startedAt - b.startedAt);
            for (let index = 0; index < group.length; index += 1) {
                if (group[index].count !== 1 || group[index].startedAt < start.getTime()) continue;
                let length = 1;
                while (
                    index + length < group.length &&
                    group[index + length].count === group[index + length - 1].count + 1 &&
                    group[index + length].startedAt - group[index + length - 1].startedAt <= 15 * 24 * 60 * 60 * 1000
                )
                    length += 1;
                if (length >= 3) {
                    const first = group[index];
                    const current = result.get(first.tid);
                    const programs = group.slice(index, index + length).map(program => ({
                        count: program.count,
                        startedAt: new Date(program.startedAt).toISOString(),
                        channelName: program.channelName,
                    }));
                    result.set(first.tid, {
                        tid: first.tid,
                        title: first.title,
                        programs: [...(current?.programs ?? []), ...programs],
                    });
                }
            }
        }
        return Array.from(result.values()).map(candidate => ({
            ...candidate,
            programs: this.uniqueSyoboiPrograms(candidate.programs),
        }));
    }

    private syoboiProgramCacheFile(annictId: number): string {
        return path.join(this.root, 'cache', `rerun-programs-v1-${annictId}.json`);
    }

    private uniqueSyoboiPrograms(programs: SyoboiRerunProgram[]): SyoboiRerunProgram[] {
        return Array.from(
            new Map(
                programs.map(program => [
                    `${program.channelName.normalize('NFKC')}:${program.startedAt}:${program.count}`,
                    program,
                ]),
            ).values(),
        ).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    }

    private async addSyoboiProgramFallback(
        annictId: number,
        work: Omit<apid.AnnictWorkDetail, 'cachedAt' | 'stale'>,
    ): Promise<Omit<apid.AnnictWorkDetail, 'cachedAt' | 'stale'>> {
        const hasFutureReceivableProgram = work.programs.some(
            program => program.localChannels.length > 0 && Date.parse(program.startedAt) >= Date.now(),
        );
        if (hasFutureReceivableProgram) return work;
        const cached = await this.readCache<SyoboiRerunProgram[]>(this.syoboiProgramCacheFile(annictId));
        if (cached === null || Date.now() - cached.cachedAt >= 24 * 60 * 60 * 1000) return work;
        const channels = await this.channelApiModel.getChannels();
        const fallback = this.mapPrograms(
            cached.value.map((program, index) => ({
                annictId: -(index + 1),
                startedAt: program.startedAt,
                rebroadcast: true,
                firstBroadcast: program.count === 1,
                episode: { number: program.count, numberText: String(program.count) },
                channel: { name: program.channelName },
            })),
            channels,
        );
        const futureReceivable = fallback.filter(
            program => program.localChannels.length > 0 && Date.parse(program.startedAt) >= Date.now(),
        );
        if (futureReceivable.length === 0) return work;
        return { ...work, programs: [...work.programs, ...futureReceivable], programsError: undefined };
    }

    private collectSyoboiItems(value: any, output: any[]): void {
        if (Array.isArray(value)) {
            value.forEach(item => this.collectSyoboiItems(item, output));
            return;
        }
        if (value === null || typeof value !== 'object') return;
        if (value.TID !== undefined || value.tid !== undefined) output.push(value);
        else Object.values(value).forEach(item => this.collectSyoboiItems(item, output));
    }

    private syoboiDate(value: Date): string {
        return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}0000`;
    }

    private normalizeTitle(value: string): string {
        return value
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[\s\u3000・･!！?？:：~〜～\-－ー]/g, '');
    }

    private readonly mapWork = (work: any): apid.AnnictWorkSummary => ({
        annictId: work.annictId,
        title: work.title,
        titleKana: work.titleKana ?? undefined,
        seasonName: work.seasonName ?? undefined,
        seasonYear: work.seasonYear ?? undefined,
        media: work.media ?? undefined,
        malAnimeId:
            typeof work.malAnimeId === 'string' || typeof work.malAnimeId === 'number'
                ? String(work.malAnimeId)
                : undefined,
        imageUrl:
            [work.image?.recommendedImageUrl, work.image?.facebookOgImageUrl].find(
                value => typeof value === 'string' && value.trim().length > 0,
            ) ?? undefined,
        watchersCount: work.watchersCount ?? undefined,
        firstProgramStartedAt: Array.isArray(work.programs?.nodes)
            ? work.programs.nodes.find((program: any) => typeof program?.startedAt === 'string')?.startedAt
            : undefined,
    });

    private async requestRecordedProgramCandidates(
        annictId: number,
        recordedStartAt: number,
    ): Promise<RecordedProgramCandidate[]> {
        const result: RecordedProgramCandidate[] = [];
        let after: string | undefined;
        const oldestRequiredAt = recordedStartAt - 6 * 60 * 60 * 1000;
        for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
            const data = await this.requestWithSavedToken(
                `query RecordedEpisodePrograms($annictId: [Int!], $after: String) {
                    searchWorks(annictIds: $annictId, first: 1) {
                        nodes {
                            programs(
                                first: 100
                                after: $after
                                orderBy: { field: STARTED_AT, direction: DESC }
                            ) {
                                nodes {
                                    annictId
                                    startedAt
                                    channel { name }
                                }
                                pageInfo { hasNextPage endCursor }
                            }
                        }
                    }
                }`,
                { annictId: [annictId], after },
            );
            const work = Array.isArray(data?.searchWorks?.nodes)
                ? data.searchWorks.nodes.find((value: any) => value !== null && typeof value === 'object')
                : undefined;
            if (work === undefined) throw new Error('Annict作品の放送予定が見つかりません');
            const nodes = Array.isArray(work.programs?.nodes)
                ? (work.programs.nodes.filter(
                      (value: any) =>
                          value !== null &&
                          typeof value === 'object' &&
                          Number.isInteger(value.annictId) &&
                          typeof value.startedAt === 'string' &&
                          typeof value.channel?.name === 'string',
                  ) as RecordedProgramCandidate[])
                : [];
            try {
                const episodeData = await this.requestWithSavedToken(
                    `query RecordedEpisodeMetadata($annictId: [Int!], $after: String) {
                        searchWorks(annictIds: $annictId, first: 1) {
                            nodes {
                                programs(
                                    first: 100
                                    after: $after
                                    orderBy: { field: STARTED_AT, direction: DESC }
                                ) {
                                    nodes {
                                        annictId
                                        episode { annictId number numberText title }
                                    }
                                }
                            }
                        }
                    }`,
                    { annictId: [annictId], after },
                );
                const episodeWork = Array.isArray(episodeData?.searchWorks?.nodes)
                    ? episodeData.searchWorks.nodes.find((value: any) => value !== null && typeof value === 'object')
                    : undefined;
                const episodes = new Map<number, RecordedProgramCandidate['episode']>();
                for (const program of Array.isArray(episodeWork?.programs?.nodes) ? episodeWork.programs.nodes : []) {
                    if (Number.isInteger(program?.annictId) && program?.episode != null) {
                        episodes.set(program.annictId, program.episode);
                    }
                }
                nodes.forEach(program => {
                    program.episode = episodes.get(program.annictId);
                });
            } catch (err) {
                this.log.system.debug(
                    `Annict recorded episode metadata unavailable: annictId=${annictId}, error=${this.errorMessage(err)}`,
                );
            }
            result.push(...nodes);
            const oldestAt = nodes.reduce((value, program) => {
                const startedAt = Date.parse(program.startedAt);
                return Number.isFinite(startedAt) ? Math.min(value, startedAt) : value;
            }, Number.POSITIVE_INFINITY);
            const hasNextPage = work.programs?.pageInfo?.hasNextPage === true;
            const endCursor =
                typeof work.programs?.pageInfo?.endCursor === 'string' ? work.programs.pageInfo.endCursor : undefined;
            if (!hasNextPage || oldestAt <= oldestRequiredAt || endCursor === undefined) break;
            after = endCursor;
        }
        return result;
    }

    private async requestRecordedEpisodeCandidates(annictId: number): Promise<RecordedEpisodeCandidate[]> {
        const result: RecordedEpisodeCandidate[] = [];
        const perPage = 50;
        for (let page = 1; page <= 20; page += 1) {
            const data = await this.requestRest('episodes', {
                filter_work_id: annictId,
                page,
                per_page: perPage,
                sort_id: 'asc',
            });
            const episodes = Array.isArray(data?.episodes) ? data.episodes : [];
            for (const episode of episodes) {
                const episodeAnnictId = Number(episode?.id);
                if (!Number.isInteger(episodeAnnictId) || episodeAnnictId <= 0) continue;
                const number =
                    typeof episode?.number === 'number' ||
                    (typeof episode?.number === 'string' && episode.number.trim().length > 0)
                        ? Number(episode.number)
                        : NaN;
                result.push({
                    annictId: episodeAnnictId,
                    number: Number.isFinite(number) ? number : undefined,
                    numberText: typeof episode?.number_text === 'string' ? episode.number_text : undefined,
                    title: typeof episode?.title === 'string' ? episode.title : undefined,
                });
            }
            if (episodes.length < perPage) break;
        }
        return result;
    }

    private singleRecordedProgram(programs: RecordedProgramCandidate[]): RecordedProgramCandidate | undefined {
        const uniquePrograms = Array.from(new Map(programs.map(program => [program.annictId, program])).values());
        return uniquePrograms.length === 1 ? uniquePrograms[0] : undefined;
    }

    private hasRecordedProgramEpisode(
        program: RecordedProgramCandidate,
    ): program is RecordedProgramCandidate & { episode: { annictId: number } } {
        return Number.isInteger(program.episode?.annictId) && program.episode!.annictId! > 0;
    }

    private async setRecordedProgramMatched(
        recordedId: apid.RecordedId,
        program: RecordedProgramCandidate & { episode: { annictId: number } },
        checkedAt: number,
    ): Promise<void> {
        await this.annictEpisodeDB.setMatched(
            recordedId,
            {
                programAnnictId: program.annictId,
                episodeAnnictId: program.episode.annictId,
                episodeNumber: typeof program.episode.number === 'number' ? program.episode.number : undefined,
                episodeNumberText:
                    typeof program.episode.numberText === 'string' ? program.episode.numberText : undefined,
                episodeTitle: typeof program.episode.title === 'string' ? program.episode.title : undefined,
            },
            checkedAt,
        );
    }

    private extractExplicitEpisodeNumbers(value: string): number[] {
        const text = value.normalize('NFKC');
        const token = `([${EPISODE_NUMBER_CHARS}]+(?:\\.[0-9]+)?)`;
        const patterns = [
            new RegExp(`#\\s*${token}`, 'gi'),
            new RegExp(`第\\s*${token}\\s*(?:話|回)`, 'gi'),
            new RegExp(`${token}\\s*(?:話|回)`, 'gi'),
            new RegExp(`(?:EPISODE|EP)\\.?\\s*${token}`, 'gi'),
        ];
        const numbers = new Set<number>();
        for (const pattern of patterns) {
            for (const match of text.matchAll(pattern)) {
                const parsed = this.parseEpisodeNumber(match[1]);
                if (parsed !== undefined) numbers.add(parsed);
            }
        }
        return [...numbers];
    }

    private parseEpisodeNumber(value: string): number | undefined {
        const normalized = value
            .normalize('NFKC')
            .replace(/廿/g, '二十')
            .replace(/[卅丗]/g, '三十');
        if (/^[0-9]+(?:\.[0-9]+)?$/.test(normalized)) {
            const result = Number(normalized);
            return Number.isFinite(result) && result >= 0 ? result : undefined;
        }
        if (
            ![...normalized].every(character => character in EPISODE_KANJI_DIGITS || character in EPISODE_KANJI_UNITS)
        ) {
            return undefined;
        }

        const hasUnit = [...normalized].some(character => character in EPISODE_KANJI_UNITS);
        if (!hasUnit) {
            const digits = [...normalized].map(character => EPISODE_KANJI_DIGITS[character]);
            if (digits.some(digit => digit === undefined)) return undefined;
            const result = Number(digits.join(''));
            return Number.isInteger(result) && result >= 0 ? result : undefined;
        }

        let result = 0;
        let digit: number | undefined;
        let previousUnit = Number.POSITIVE_INFINITY;
        for (const character of normalized) {
            if (character in EPISODE_KANJI_DIGITS) {
                if (digit !== undefined) return undefined;
                digit = EPISODE_KANJI_DIGITS[character];
                continue;
            }
            const unit = EPISODE_KANJI_UNITS[character];
            if (unit === undefined || unit >= previousUnit) return undefined;
            result += (digit ?? 1) * unit;
            digit = undefined;
            previousUnit = unit;
        }
        result += digit ?? 0;
        return Number.isInteger(result) && result >= 0 && result <= 9999 ? result : undefined;
    }

    private recordedEpisodeNumberMatches(episode: RecordedEpisodeCandidate, expected: number): boolean {
        if (typeof episode.number === 'number' && Math.abs(episode.number - expected) < 0.000001) return true;
        if (typeof episode.numberText !== 'string') return false;
        const values = this.extractExplicitEpisodeNumbers(episode.numberText);
        if (values.some(value => Math.abs(value - expected) < 0.000001)) return true;
        const plainNumber = this.parseEpisodeNumber(
            episode.numberText
                .normalize('NFKC')
                .trim()
                .replace(/^第/, '')
                .replace(/[話回]$/, ''),
        );
        return plainNumber !== undefined && Math.abs(plainNumber - expected) < 0.000001;
    }

    private async markEpisodeWatchedOnce(
        episodeAnnictId: number,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<void> {
        const current = await this.annictEpisodeDB.beginWatch(episodeAnnictId, viewerProfileId);
        if (current.status === 'watched') {
            void this.syncPendingEpisodeWatchStatus(episodeAnnictId, viewerProfileId).catch(err => {
                this.log.system.warn(
                    `Annict pending viewer status sync failed: episodeAnnictId=${episodeAnnictId}, viewerProfileId=${viewerProfileId}, error=${this.errorMessage(err)}`,
                );
            });
            return;
        }
        try {
            const token = await this.readWriteToken(viewerProfileId);
            if (token === null) throw new Error('Annict書き込み連携が設定されていません');
            const trackedData = await this.request(
                token,
                `query ViewerEpisodeTrack($annictIds: [Int!]) {
                    searchEpisodes(annictIds: $annictIds, first: 1) {
                        nodes {
                            annictId
                            viewerDidTrack
                            work { annictId }
                        }
                    }
                }`,
                { annictIds: [episodeAnnictId] },
                true,
            );
            const episode = Array.isArray(trackedData?.searchEpisodes?.nodes)
                ? trackedData.searchEpisodes.nodes.find((value: any) => Number(value?.annictId) === episodeAnnictId)
                : undefined;
            if (episode === undefined) throw new Error('Annictエピソードが見つかりません');

            let annictRecordId: number | null = null;
            const wasTracked = episode.viewerDidTrack === true;
            const workAnnictId = Number(episode.work?.annictId);
            if (!wasTracked) {
                const response = await axios.post(
                    'https://api.annict.com/v1/me/records',
                    new URLSearchParams({ episode_id: String(episodeAnnictId) }),
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        timeout: 20_000,
                    },
                );
                annictRecordId = Number.isInteger(Number(response.data?.id)) ? Number(response.data.id) : null;
            }
            const hasWork = Number.isInteger(workAnnictId) && workAnnictId > 0;
            await this.annictEpisodeDB.setWatched(
                episodeAnnictId,
                viewerProfileId,
                annictRecordId,
                hasWork ? workAnnictId : null,
                !wasTracked && hasWork,
                Date.now(),
            );
            if (!wasTracked && hasWork) {
                void this.syncPendingEpisodeWatchStatus(episodeAnnictId, viewerProfileId).catch(err => {
                    this.log.system.warn(
                        `Annict viewer status sync failed after episode record: episodeAnnictId=${episodeAnnictId}, ` +
                            `viewerProfileId=${viewerProfileId}, error=${this.errorMessage(err)}`,
                    );
                });
            }
        } catch (err) {
            await this.annictEpisodeDB
                .setWatchFailed(episodeAnnictId, viewerProfileId, this.errorMessage(err))
                .catch(() => {});
            throw err;
        }
    }

    private async syncPendingEpisodeWatchStatus(
        episodeAnnictId: number,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<void> {
        const key = `${episodeAnnictId}:${viewerProfileId}`;
        const currentRequest = this.episodeStatusSyncRequests.get(key);
        if (currentRequest !== undefined) {
            await currentRequest;
            return;
        }
        const request = this.syncPendingEpisodeWatchStatusOnce(episodeAnnictId, viewerProfileId)
            .catch(async err => {
                await this.annictEpisodeDB
                    .scheduleWatchRetry(episodeAnnictId, viewerProfileId, this.errorMessage(err))
                    .catch(() => {});
                throw err;
            })
            .finally(() => {
                this.episodeStatusSyncRequests.delete(key);
            });
        this.episodeStatusSyncRequests.set(key, request);
        await request;
    }

    private async syncPendingEpisodeWatchStatusOnce(
        episodeAnnictId: number,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<void> {
        const watch = await this.annictEpisodeDB.findWatch(episodeAnnictId, viewerProfileId);
        const workAnnictId = watch?.workAnnictId ?? null;
        if (
            watch?.status !== 'watched' ||
            !watch.statusSyncPending ||
            typeof workAnnictId !== 'number' ||
            !Number.isInteger(workAnnictId) ||
            workAnnictId <= 0
        ) {
            return;
        }
        const current = (await this.getViewerStatuses([workAnnictId], viewerProfileId)).statuses.find(
            status => status.annictId === workAnnictId,
        )?.kind;
        if (current !== 'watching' && current !== 'watched') {
            await this.setViewerStatus(workAnnictId, 'watching', viewerProfileId);
        }
        await this.annictEpisodeDB.clearWatchStatusSync(episodeAnnictId, viewerProfileId);
    }

    private async syncPendingEpisodeCompletion(
        recordedId: apid.RecordedId,
        episodeAnnictId: number,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<void> {
        const key = `${episodeAnnictId}:${viewerProfileId}`;
        const currentRequest = this.episodeCompletionRequests.get(key);
        if (currentRequest !== undefined) {
            await currentRequest;
            return;
        }
        const request = this.syncPendingEpisodeCompletionOnce(recordedId, episodeAnnictId, viewerProfileId)
            .catch(async err => {
                await this.annictEpisodeDB
                    .scheduleWatchRetry(episodeAnnictId, viewerProfileId, this.errorMessage(err))
                    .catch(() => {});
                throw err;
            })
            .finally(() => {
                this.episodeCompletionRequests.delete(key);
            });
        this.episodeCompletionRequests.set(key, request);
        await request;
    }

    private async syncPendingEpisodeCompletionOnce(
        recordedId: apid.RecordedId,
        episodeAnnictId: number,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<void> {
        const [watch, recorded, mapping] = await Promise.all([
            this.annictEpisodeDB.findWatch(episodeAnnictId, viewerProfileId),
            this.recordedDB.findId(recordedId),
            this.annictEpisodeDB.findRecorded(recordedId),
        ]);
        if (watch?.status !== 'watched' || (!watch.completionPending && !watch.ruleDisablePending)) {
            return;
        }
        if (recorded === null || mapping === null) {
            await this.syncPendingEpisodeCompletionWithoutRecordedOnce(watch);
            return;
        }

        const finalMarkerText = [recorded.name, recorded.description ?? '', recorded.extended ?? ''].join(' ');
        const hasExplicitFinalMarker = this.hasExplicitFinalEpisodeMarker(finalMarkerText);
        const token = await this.readWriteToken(viewerProfileId);
        if (token === null) throw new Error('Annict書き込み連携が設定されていません');
        const workAnnictId = mapping.annictId;
        let annictHasNoNextEpisode: boolean | undefined;
        let annictConfirmsFinalEpisode = false;

        if (!hasExplicitFinalMarker || watch.ruleDisablePending) {
            try {
                const data = await this.request(
                    token,
                    `query EpisodeCompletion($annictIds: [Int!]) {
                        searchEpisodes(annictIds: $annictIds, first: 1) {
                            nodes {
                                annictId
                                number
                                numberText
                                nextEpisode { annictId }
                                work { annictId episodesCount }
                            }
                        }
                    }`,
                    { annictIds: [episodeAnnictId] },
                    true,
                );
                const episode = Array.isArray(data?.searchEpisodes?.nodes)
                    ? data.searchEpisodes.nodes.find((value: any) => Number(value?.annictId) === episodeAnnictId)
                    : undefined;
                if (episode !== undefined && episode.nextEpisode !== undefined) {
                    const episodeWorkAnnictId = Number(episode.work?.annictId);
                    const episodeNumber = Number(episode.number);
                    const episodesCount = Number(episode.work?.episodesCount);
                    if (!Number.isInteger(episodeWorkAnnictId) || episodeWorkAnnictId !== workAnnictId) {
                        throw new Error('Annictエピソードの作品IDが録画対応と一致しません');
                    }
                    annictHasNoNextEpisode = episode.nextEpisode === null;
                    annictConfirmsFinalEpisode =
                        annictHasNoNextEpisode &&
                        Number.isInteger(episodeNumber) &&
                        episodeNumber > 0 &&
                        Number.isInteger(episodesCount) &&
                        episodesCount > 0 &&
                        episodeNumber === episodesCount;
                }
            } catch (err) {
                if (!hasExplicitFinalMarker) throw err;
                this.log.system.warn(
                    `Annict final episode confirmation failed: recordedId=${recordedId}, episodeAnnictId=${episodeAnnictId}, error=${this.errorMessage(err)}`,
                );
            }
        }

        if (!hasExplicitFinalMarker && !annictConfirmsFinalEpisode) {
            if (annictHasNoNextEpisode === false) {
                await this.annictEpisodeDB.clearCompletionPending(episodeAnnictId, viewerProfileId);
            } else {
                await this.annictEpisodeDB.scheduleWatchRetry(
                    episodeAnnictId,
                    viewerProfileId,
                    'Annictの最終話情報がまだ確定していません',
                );
            }
            // Annict may not have registered the next episode yet. Keep uncertain results pending.
            return;
        }

        if (watch.completionPending) {
            const current = (await this.getViewerStatuses([workAnnictId], viewerProfileId)).statuses.find(
                status => status.annictId === workAnnictId,
            )?.kind;
            if (current !== 'watched') {
                await this.setViewerStatus(workAnnictId, 'watched', viewerProfileId);
            }
            await this.annictEpisodeDB.clearWorkCompletionPending(episodeAnnictId, viewerProfileId);
        }

        if (watch.ruleDisablePending) {
            if (annictHasNoNextEpisode === false) {
                await this.annictEpisodeDB.clearRuleDisablePending(episodeAnnictId, viewerProfileId);
                return;
            }
            if (annictHasNoNextEpisode !== true) {
                await this.annictEpisodeDB.scheduleWatchRetry(
                    episodeAnnictId,
                    viewerProfileId,
                    'Annictに次話がないことをまだ確認できません',
                );
                return;
            }

            await this.disableCompletedWorkRules(workAnnictId, episodeAnnictId, viewerProfileId);
        }
    }

    private hasExplicitFinalEpisodeMarker(value: string): boolean {
        const normalized = value.normalize('NFKC');
        return (
            /(?:\[|【|\()\s*(?:終|最終回)\s*(?:\]|】|\))/u.test(normalized) ||
            /(?:^|\s)最終(?:話|回)(?=$|[\s「『#＃])/u.test(normalized)
        );
    }

    private async getPrograms(
        annictId: number,
        channels: apid.ChannelItem[],
        seasonYear?: number,
        seasonName?: string,
    ): Promise<{ programs: apid.AnnictProgram[]; error?: string }> {
        let nodes: any[];
        try {
            nodes = await this.requestProgramNodes(annictId, seasonYear, seasonName);
        } catch (err) {
            this.log.system.warn(
                `Annict GraphQL programs failed: annictId=${annictId}, error=${this.errorMessage(err)}`,
            );
            try {
                nodes = await this.requestLegacyProgramNodes(annictId);
            } catch (fallbackError) {
                this.log.system.warn(
                    `Annict program fallback failed: annictId=${annictId}, error=${this.errorMessage(fallbackError)}`,
                );
                return {
                    programs: [],
                    error: 'Annictの放送日時と放送局を取得できませんでした。時間をおいて更新してください。',
                };
            }
        }

        return { programs: this.mapPrograms(this.annotatePrograms(nodes), channels) };
    }

    private async requestProgramNodes(annictId: number, seasonYear?: number, seasonName?: string): Promise<any[]> {
        const result: any[] = [];
        let after: string | undefined;
        const oldestRequiredAt = this.seasonStart(seasonYear, seasonName) - 14 * 24 * 60 * 60 * 1000;

        for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
            const page = await this.requestProgramPage(annictId, after);
            result.push(...page.nodes);
            const oldestAt = page.nodes.reduce((value, program) => {
                const startedAt = typeof program?.startedAt === 'string' ? Date.parse(program.startedAt) : NaN;
                return Number.isFinite(startedAt) ? Math.min(value, startedAt) : value;
            }, Number.POSITIVE_INFINITY);
            if (!page.hasNextPage || oldestAt < oldestRequiredAt || page.endCursor === undefined) break;
            after = page.endCursor;
        }

        return result.filter(program => {
            const startedAt = typeof program?.startedAt === 'string' ? Date.parse(program.startedAt) : NaN;
            return Number.isFinite(startedAt) && startedAt >= oldestRequiredAt;
        });
    }

    private async requestLegacyProgramNodes(annictId: number): Promise<any[]> {
        const data = await this.requestWithSavedToken(
            `query WorkProgramsFallback($annictId: [Int!]) {
                searchWorks(annictIds: $annictId, first: 1) {
                    nodes {
                        programs(last: 100) {
                            nodes { annictId startedAt rebroadcast channel { annictId name } }
                        }
                    }
                }
            }`,
            { annictId: [annictId] },
        );
        const node = Array.isArray(data?.searchWorks?.nodes)
            ? data.searchWorks.nodes.find((work: any) => work !== null && typeof work === 'object')
            : undefined;
        if (node === undefined) throw new Error('Annict作品の放送予定が見つかりません');
        return Array.isArray(node.programs?.nodes) ? node.programs.nodes : [];
    }

    private async requestProgramPage(annictId: number, after?: string): Promise<AnnictProgramPage> {
        const data = await this.requestWithSavedToken(
            `query WorkPrograms($annictId: [Int!], $after: String) {
                searchWorks(annictIds: $annictId, first: 1) {
                    nodes {
                        programs(
                            first: 100
                            after: $after
                            orderBy: { field: STARTED_AT, direction: DESC }
                        ) {
                            nodes { id annictId startedAt rebroadcast channel { annictId name } }
                            pageInfo { hasNextPage endCursor }
                        }
                    }
                }
            }`,
            { annictId: [annictId], after },
        );
        const node = Array.isArray(data?.searchWorks?.nodes)
            ? data.searchWorks.nodes.find((work: any) => work !== null && typeof work === 'object')
            : undefined;
        if (node === undefined) throw new Error('Annict作品の放送予定が見つかりません');
        const nodes = Array.isArray(node.programs?.nodes) ? node.programs.nodes : [];
        try {
            const episodeData = await this.requestWithSavedToken(
                `query WorkProgramEpisodes($annictId: [Int!], $after: String) {
                    searchWorks(annictIds: $annictId, first: 1) {
                        nodes {
                            programs(first: 100, after: $after, orderBy: { field: STARTED_AT, direction: DESC }) {
                                nodes { annictId episode { number numberText title } }
                            }
                        }
                    }
                }`,
                { annictId: [annictId], after },
            );
            const episodeWork = Array.isArray(episodeData?.searchWorks?.nodes)
                ? episodeData.searchWorks.nodes.find((work: any) => work !== null && typeof work === 'object')
                : undefined;
            const episodes = new Map<number, any>();
            for (const program of Array.isArray(episodeWork?.programs?.nodes) ? episodeWork.programs.nodes : []) {
                if (Number.isFinite(program?.annictId) && program?.episode != null)
                    episodes.set(program.annictId, program.episode);
            }
            nodes.forEach((program: any) => {
                if (Number.isFinite(program?.annictId)) program.episode = episodes.get(program.annictId);
            });
        } catch (err) {
            this.log.system.debug(
                `Annict episode metadata unavailable: annictId=${annictId}, error=${this.errorMessage(err)}`,
            );
        }
        return {
            nodes,
            hasNextPage: node.programs?.pageInfo?.hasNextPage === true,
            endCursor:
                typeof node.programs?.pageInfo?.endCursor === 'string' ? node.programs.pageInfo.endCursor : undefined,
        };
    }

    private seasonStart(year?: number, name?: string): number {
        const month: Record<string, number> = { winter: 0, spring: 3, summer: 6, autumn: 9 };
        return Number.isFinite(year) && name !== undefined && month[name.toLowerCase()] !== undefined
            ? Date.UTC(year!, month[name.toLowerCase()], 1)
            : Date.now() - 120 * 24 * 60 * 60 * 1000;
    }

    private annotatePrograms(programs: any[]): any[] {
        const groups = new Map<string, any[]>();
        for (const program of programs) {
            if (program?.channel == null || typeof program.startedAt !== 'string') continue;
            const key = Number.isFinite(program.channel.annictId)
                ? `id:${program.channel.annictId}`
                : `name:${program.channel.name}`;
            const group = groups.get(key) ?? [];
            group.push(program);
            groups.set(key, group);
        }
        for (const group of groups.values()) {
            group.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
            if (group[0] !== undefined) group[0].firstBroadcast = true;
            const anchors = group.flatMap((program, index) =>
                typeof program.episode?.number === 'number' ? [{ index, number: program.episode.number }] : [],
            );
            group.forEach((program, index) => {
                if (typeof program.episode?.number === 'number' || anchors.length === 0) return;
                const anchor = anchors.reduce((best, value) =>
                    Math.abs(value.index - index) < Math.abs(best.index - index) ? value : best,
                );
                const estimated = anchor.number + index - anchor.index;
                if (Number.isInteger(estimated) && estimated > 0) {
                    program.episode = { ...(program.episode ?? {}), number: estimated };
                    program.episodeNumberEstimated = true;
                }
            });
        }
        return programs;
    }

    private mapPrograms(programNodes: any[], channels: apid.ChannelItem[]): apid.AnnictProgram[] {
        return programNodes
            .flatMap((program: any) => {
                if (
                    program === null ||
                    typeof program !== 'object' ||
                    !Number.isFinite(program.annictId) ||
                    typeof program.startedAt !== 'string' ||
                    typeof program.channel?.name !== 'string'
                ) {
                    return [];
                }
                const channelName = program.channel.name;
                const episode = program.episode;
                return [
                    {
                        annictId: program.annictId,
                        startedAt: program.startedAt,
                        channelAnnictId: Number.isFinite(program.channel.annictId)
                            ? program.channel.annictId
                            : undefined,
                        channelName,
                        episodeNumber: typeof episode?.number === 'number' ? episode.number : undefined,
                        episodeNumberText: typeof episode?.numberText === 'string' ? episode.numberText : undefined,
                        episodeTitle: typeof episode?.title === 'string' ? episode.title : undefined,
                        episodeNumberEstimated: program.episodeNumberEstimated === true,
                        firstBroadcast: program.firstBroadcast === true,
                        rebroadcast: Boolean(program.rebroadcast),
                        localChannels: channels
                            .filter(channel => this.isSelectableLocalChannel(channel))
                            .map(channel => ({ channel, name: this.localChannelName(channel) }))
                            .filter(item => item.name !== undefined && this.channelNamesMatch(channelName, item.name))
                            .map(channel => ({
                                id: channel.channel.id,
                                name: channel.name!,
                                channelType: channel.channel.channelType,
                            })),
                    },
                ];
            })
            .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    }

    private localChannelName(channel: apid.ChannelItem): string | undefined {
        for (const value of [channel.name, channel.halfWidthName]) {
            if (typeof value === 'string' && value.trim().length > 0) return value.trim();
        }
        return undefined;
    }

    private isSelectableLocalChannel(channel: apid.ChannelItem): boolean {
        const name = this.localChannelName(channel)?.normalize('NFKC') ?? '';
        return channel.type !== 192 && !name.includes('携帯');
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private channelNamesMatch(annictName: string, localName: string): boolean {
        const normalize = (value: string): string => {
            let result = value
                .normalize('NFKC')
                .toUpperCase()
                .replace(/[\s\u3000・･\-－ー]/g, '')
                .replace(/[~〜～]/g, '~')
                .replace(/テレビジョン/g, 'テレビ')
                .replace(/朝日放送テレビ/g, 'ABCテレビ')
                .replace(/^NHK総合.*$/, 'NHK総合')
                .replace(/^NHKEテレ.*$/, 'NHKEテレ')
                .replace(/([^\d])[1-3]$/, '$1');
            result = CHANNEL_NAME_ALIASES[result] ?? result;
            return result;
        };
        const left = normalize(annictName);
        const right = normalize(localName);
        if (left.length === 0 || right.length === 0) return false;
        if ((left === 'WOWOW' && right === 'WOWOWプラス') || (right === 'WOWOW' && left === 'WOWOWプラス')) {
            return false;
        }
        return left === right;
    }

    private async fillMissingWorkImages(works: apid.AnnictWorkSummary[]): Promise<apid.AnnictWorkSummary[]> {
        const missing = works.filter(work => work.imageUrl === undefined);
        if (missing.length === 0) return works;
        const token = await this.readToken();

        const urls = new Map<number, string>();
        if (token !== null) {
            try {
                for (let index = 0; index < missing.length; index += 50) {
                    const response = await axios.get('https://api.annict.com/v1/works', {
                        headers: { Authorization: `Bearer ${token}` },
                        params: {
                            filter_ids: missing
                                .slice(index, index + 50)
                                .map(work => work.annictId)
                                .join(','),
                            per_page: 50,
                        },
                        timeout: 20_000,
                    });
                    for (const work of Array.isArray(response.data?.works) ? response.data.works : []) {
                        const imageUrl = this.restWorkImageUrl(work);
                        if (Number.isFinite(work?.id) && imageUrl !== undefined) urls.set(work.id, imageUrl);
                    }
                }
            } catch (err) {
                this.log.system.warn(`Annict REST work images failed: error=${this.errorMessage(err)}`);
            }
        }

        const resolved = works.map(work => ({ ...work, imageUrl: work.imageUrl ?? urls.get(work.annictId) }));
        const pageUrls = new Map<number, string>();
        const unresolved = resolved.filter(work => work.imageUrl === undefined);
        for (let index = 0; index < unresolved.length; index += 3) {
            await Promise.all(
                unresolved.slice(index, index + 3).map(async work => {
                    const imageUrl = (await this.getAnnictPageMetadata(work.annictId)).imageUrl;
                    if (imageUrl !== undefined) pageUrls.set(work.annictId, imageUrl);
                }),
            );
        }
        const pageResolved = resolved.map(work => ({
            ...work,
            imageUrl: work.imageUrl ?? pageUrls.get(work.annictId),
        }));
        const jikanUrls = new Map<number, string>();
        const jikanCandidates = pageResolved.filter(
            work => work.imageUrl === undefined && work.malAnimeId !== undefined,
        );
        for (let index = 0; index < jikanCandidates.length; index += 1) {
            const work = jikanCandidates[index];
            const imageUrl = await this.getJikanImageUrl(work.malAnimeId!);
            if (imageUrl !== undefined) jikanUrls.set(work.annictId, imageUrl);
            if (index + 1 < jikanCandidates.length) await new Promise(resolve => setTimeout(resolve, 350));
        }
        return pageResolved.map(work => ({
            ...work,
            imageUrl: work.imageUrl ?? jikanUrls.get(work.annictId),
        }));
    }

    private restWorkImageUrl(work: any): string | undefined {
        return [
            work?.images?.recommended_url,
            work?.images?.facebook?.og_image_url,
            work?.images?.twitter?.image_url,
        ].find(value => typeof value === 'string' && value.trim().length > 0);
    }

    private async resolveWorkImageUrl(values: Array<string | undefined>): Promise<string | undefined> {
        const candidates = Array.from(
            new Set(
                values
                    .map(value => (value === undefined ? undefined : this.safeHttpsUrl(value)))
                    .filter((value): value is string => value !== undefined),
            ),
        );
        for (const candidate of candidates) {
            if (await this.isUsableRemoteImage(candidate)) return candidate;
        }
        return undefined;
    }

    private async isUsableRemoteImage(value: string): Promise<boolean> {
        try {
            const response = await axios.get(value, {
                timeout: 10_000,
                responseType: 'stream',
                maxRedirects: 5,
                validateStatus: status => status >= 200 && status < 400,
            });
            const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
            const stream = response.data as { destroy?: () => void };
            stream.destroy?.();
            return contentType.startsWith('image/');
        } catch (_err) {
            return false;
        }
    }

    private async getAnnictPageMetadata(annictId: number): Promise<AnnictPageMetadata> {
        const file = path.join(this.root, 'cache', `work-page-v4-${annictId}.json`);
        const cached = await this.readCache<AnnictPageMetadata>(file);
        if (cached !== null && Date.now() - cached.cachedAt < 30 * 24 * 60 * 60 * 1000) return cached.value;

        const metadata: AnnictPageMetadata = {};
        try {
            const response = await axios.get<string>(`https://annict.com/works/${annictId}`, {
                timeout: 20_000,
                responseType: 'text',
            });
            const metaTags = response.data.match(/<meta\b[^>]*>/gi) ?? [];
            for (const tag of metaTags) {
                const property = this.htmlAttribute(tag, 'property') ?? this.htmlAttribute(tag, 'name');
                if (property?.toLowerCase() !== 'og:image') continue;
                const content = this.htmlAttribute(tag, 'content');
                if (content === undefined) continue;
                const candidate = new URL(content.replace(/&amp;/g, '&'));
                if (candidate.protocol === 'https:' && candidate.hostname === 'image.annict.com') {
                    metadata.imageUrl = candidate.toString();
                    break;
                }
            }

            const synopsisHeading = response.data.search(/<h2\b[^>]*>\s*あらすじ\s*<\/h2>/i);
            if (synopsisHeading >= 0) {
                const synopsisSection = response.data.slice(synopsisHeading);
                const synopsisMatch = synopsisSection.match(
                    /<div\b[^>]*class=(?:"[^"]*\bc-body__content\b[^"]*"|'[^']*\bc-body__content\b[^']*')[^>]*>([\s\S]*?)<\/div>/i,
                );
                if (synopsisMatch !== null) {
                    metadata.synopsis = this.htmlToText(synopsisMatch[1]) || undefined;
                    const afterSynopsis = synopsisSection.slice(
                        (synopsisMatch.index ?? 0) + synopsisMatch[0].length,
                        (synopsisMatch.index ?? 0) + synopsisMatch[0].length + 1500,
                    );
                    const sourceMatch = afterSynopsis.match(
                        /引用元\s*:\s*<a\b[^>]*href=(?:"([^"]+)"|'([^']+)')[^>]*>/i,
                    );
                    const plainSourceMatch = afterSynopsis.match(/引用元\s*:\s*(https:\/\/[^\s<]+)/i);
                    metadata.synopsisSource = this.safeHttpsUrl(
                        this.decodeHtml(sourceMatch?.[1] ?? sourceMatch?.[2] ?? plainSourceMatch?.[1] ?? ''),
                    );
                }
            }
        } catch (err) {
            this.log.system.warn(
                `Annict work page metadata failed: annictId=${annictId}, error=${this.errorMessage(err)}`,
            );
        }

        await this.writeJson(file, { cachedAt: Date.now(), value: metadata });
        return metadata;
    }

    private async getRestWorkDetail(annictId: number): Promise<AnnictRestWorkDetail | undefined> {
        try {
            const data = await this.requestRest('works', { filter_ids: String(annictId), per_page: 1 });
            const work = Array.isArray(data?.works) ? data.works[0] : undefined;
            if (work === undefined) return undefined;
            return {
                imageUrl: this.restWorkImageUrl(work),
                releasedOn: this.optionalString(work.released_on),
                releasedOnAbout: this.optionalString(work.released_on_about),
            };
        } catch (err) {
            this.log.system.warn(
                `Annict REST work detail failed: annictId=${annictId}, error=${this.errorMessage(err)}`,
            );
            return undefined;
        }
    }

    private async enrichWorkReleaseDates(works: apid.AnnictWorkSummary[]): Promise<apid.AnnictWorkSummary[]> {
        const dates = new Map<number, Pick<apid.AnnictWorkSummary, 'releasedOn' | 'releasedOnAbout'>>();
        try {
            for (let index = 0; index < works.length; index += 50) {
                const batch = works.slice(index, index + 50);
                const data = await this.requestRest('works', {
                    filter_ids: batch.map(work => work.annictId).join(','),
                    page: 1,
                    per_page: 50,
                });
                const restWorks = Array.isArray(data?.works) ? data.works : [];
                restWorks.forEach((work: any) => {
                    if (!Number.isFinite(work?.id)) return;
                    dates.set(work.id, {
                        releasedOn: this.optionalString(work.released_on),
                        releasedOnAbout: this.optionalString(work.released_on_about),
                    });
                });
            }
        } catch (err) {
            this.log.system.warn(`Annict REST work dates failed: error=${this.errorMessage(err)}`);
            return works;
        }
        return works.map(work => ({ ...work, ...dates.get(work.annictId) }));
    }

    private async getAnnictInfoPageReleasedOn(annictId: number): Promise<string | undefined> {
        const file = path.join(this.root, 'cache', `work-info-released-on-v1-${annictId}.json`);
        const cached = await this.readCache<string | null>(file);
        if (cached !== null && Date.now() - cached.cachedAt < 30 * 24 * 60 * 60 * 1000) {
            return cached.value ?? undefined;
        }

        let releasedOn: string | undefined;
        try {
            const response = await axios.get<string>(`https://annict.com/works/${annictId}/info`, {
                timeout: 20_000,
                responseType: 'text',
            });
            const match = response.data.match(/放送開始日[\s\S]{0,300}?<div\b[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/div>/i);
            releasedOn = match?.[1];
        } catch (err) {
            this.log.system.warn(
                `Annict info page released date failed: annictId=${annictId}, error=${this.errorMessage(err)}`,
            );
        }
        await this.writeJson(file, { cachedAt: Date.now(), value: releasedOn ?? null });
        return releasedOn;
    }

    private async getRestCasts(annictId: number): Promise<apid.AnnictCast[]> {
        try {
            const items = await this.getRestItems('casts', annictId);
            return items
                .sort((a, b) => (Number(a?.sort_number) || 0) - (Number(b?.sort_number) || 0))
                .flatMap((cast: any) => {
                    const name = this.optionalString(cast?.name);
                    if (!Number.isFinite(cast?.id) || name === undefined) return [];
                    return [
                        {
                            annictId: cast.id,
                            name,
                            characterName: this.optionalString(cast?.character?.name),
                            personName: this.optionalString(cast?.person?.name),
                        },
                    ];
                });
        } catch (err) {
            this.log.system.warn(`Annict REST casts failed: annictId=${annictId}, error=${this.errorMessage(err)}`);
            return [];
        }
    }

    private async getRestStaffs(annictId: number): Promise<apid.AnnictStaff[]> {
        try {
            const items = await this.getRestItems('staffs', annictId);
            return items
                .sort((a, b) => (Number(a?.sort_number) || 0) - (Number(b?.sort_number) || 0))
                .flatMap((staff: any) => {
                    const name = this.optionalString(staff?.name);
                    if (!Number.isFinite(staff?.id) || name === undefined) return [];
                    return [
                        {
                            annictId: staff.id,
                            name,
                            role: this.optionalString(staff?.role_text) ?? this.optionalString(staff?.role_other),
                        },
                    ];
                });
        } catch (err) {
            this.log.system.warn(`Annict REST staffs failed: annictId=${annictId}, error=${this.errorMessage(err)}`);
            return [];
        }
    }

    private async getRestItems(resource: 'casts' | 'staffs', annictId: number): Promise<any[]> {
        const result: any[] = [];
        for (let page = 1; page <= 10; page += 1) {
            const data = await this.requestRest(resource, {
                filter_work_id: annictId,
                page,
                per_page: 50,
            });
            const items = Array.isArray(data?.[resource]) ? data[resource] : [];
            result.push(...items);
            if (items.length < 50) break;
        }
        return result;
    }

    private async requestRest(resource: string, params: object): Promise<any> {
        const token = await this.readToken();
        if (token === null) throw new Error('Annict連携が設定されていません');
        return this.requestRestWithToken(token, resource, params);
    }

    private async requestWriteRest(
        resource: string,
        params: object,
        viewerProfileId: apid.ViewerProfileId,
    ): Promise<any> {
        const token = await this.readWriteToken(viewerProfileId);
        if (token === null) throw new Error('Annict書き込み連携が設定されていません');
        return this.requestRestWithToken(token, resource, params);
    }

    private async requestRestWithToken(token: string, resource: string, params: object): Promise<any> {
        const response = await axios.get(`https://api.annict.com/v1/${resource}`, {
            headers: { Authorization: `Bearer ${token}` },
            params,
            timeout: 20_000,
        });
        return response.data;
    }

    private validAnnictIds(values: number[]): number[] {
        return Array.from(new Set(values.filter(value => Number.isInteger(value) && value > 0)));
    }

    private isViewerStatusKind(value: unknown): value is apid.AnnictViewerStatusKind {
        return ['wanna_watch', 'watching', 'watched', 'on_hold', 'stop_watching', 'no_select'].includes(String(value));
    }

    private isRecordedEpisodePendingReason(value: unknown): value is apid.AnnictRecordedEpisodePendingReason {
        return [
            'not_checked',
            'program_not_found',
            'program_ambiguous',
            'episode_unavailable',
            'annict_unavailable',
        ].includes(String(value));
    }

    private async getJikanImageUrl(malAnimeId: string): Promise<string | undefined> {
        if (!/^\d+$/.test(malAnimeId)) return undefined;
        const file = path.join(this.root, 'cache', `jikan-image-v1-${malAnimeId}.json`);
        const cached = await this.readCache<string | null>(file);
        const maxAge = cached?.value === null ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
        if (cached !== null && Date.now() - cached.cachedAt < maxAge) return cached.value ?? undefined;

        let imageUrl: string | undefined;
        try {
            const response = await axios.get(`https://api.jikan.moe/v4/anime/${malAnimeId}`, {
                timeout: 20_000,
            });
            const candidates = [
                response.data?.data?.images?.webp?.large_image_url,
                response.data?.data?.images?.jpg?.large_image_url,
                response.data?.data?.images?.webp?.image_url,
                response.data?.data?.images?.jpg?.image_url,
            ];
            imageUrl = candidates
                .map(value => (typeof value === 'string' ? this.safeHttpsUrl(value) : undefined))
                .find((value): value is string => value !== undefined);
        } catch (err) {
            this.log.system.warn(`Jikan work image failed: malAnimeId=${malAnimeId}, error=${this.errorMessage(err)}`);
        }
        await this.writeJson(file, { cachedAt: Date.now(), value: imageUrl ?? null });
        return imageUrl;
    }

    private optionalString(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
    }

    private safeHttpsUrl(value: string): string | undefined {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' ? url.toString() : undefined;
        } catch (_err) {
            return undefined;
        }
    }

    private htmlToText(value: string): string {
        return this.decodeHtml(
            value
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/p\s*>/gi, '\n')
                .replace(/<[^>]+>/g, ''),
        )
            .replace(/\r/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private decodeHtml(value: string): string {
        const named: { [key: string]: string } = {
            amp: '&',
            apos: "'",
            gt: '>',
            lt: '<',
            nbsp: ' ',
            quot: '"',
        };
        return value
            .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
            .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
            .replace(/&([a-z]+);/gi, (match, name) => named[String(name).toLowerCase()] ?? match);
    }

    private htmlAttribute(tag: string, name: string): string | undefined {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = tag.match(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
        return match?.[1] ?? match?.[2] ?? match?.[3];
    }

    private async requestWithSavedToken(query: string, variables: object, rejectPartialErrors = false): Promise<any> {
        const token = await this.readToken();
        if (token === null) throw new Error('Annict連携が設定されていません');
        return this.request(token, query, variables, rejectPartialErrors);
    }

    private async request(token: string, query: string, variables: object, rejectPartialErrors = false): Promise<any> {
        const response = await axios.post(
            'https://api.annict.com/graphql',
            { query, variables },
            {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 20_000,
            },
        );
        if (
            Array.isArray(response.data?.errors) &&
            response.data.errors.length > 0 &&
            (response.data?.data == null || rejectPartialErrors)
        ) {
            throw new Error(response.data.errors.map((error: any) => error.message).join(', '));
        }
        return response.data.data;
    }

    private async readToken(): Promise<string | null> {
        try {
            const value = JSON.parse(
                await fs.promises.readFile(path.join(this.root, 'settings.json'), 'utf8'),
            ) as TokenFile;
            return typeof value.accessToken === 'string' && value.accessToken.length > 0 ? value.accessToken : null;
        } catch (err: any) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    }

    private async readWriteToken(viewerProfileId: apid.ViewerProfileId): Promise<string | null> {
        this.assertViewerProfileId(viewerProfileId);
        return this.viewerProfileApiModel.getCredential(viewerProfileId, 'annict');
    }

    private assertViewerProfileId(viewerProfileId: number): void {
        if (!Number.isInteger(viewerProfileId) || viewerProfileId <= 0) {
            throw new Error('視聴者プロフィールIDが不正です');
        }
    }

    private async hasAnotherEnabledLinkedRule(
        annictId: number,
        viewerProfileId: number | null | undefined,
        excludedRuleId: number,
    ): Promise<boolean> {
        const links = await this.annictRuleLinkDB.findWork(annictId, viewerProfileId);
        for (const link of links) {
            if (link.ruleId === excludedRuleId) continue;
            const rule = await this.ruleDB.findId(link.ruleId);
            if (rule?.reserveOption.enable === true) return true;
        }
        return false;
    }

    private async ensureLegacyRuleLinksImported(): Promise<void> {
        if (this.legacyRuleLinksImported) return;
        if (this.legacyRuleLinksImport === undefined) {
            this.legacyRuleLinksImport = this.importLegacyRuleLinks();
        }
        try {
            await this.legacyRuleLinksImport;
            this.legacyRuleLinksImported = true;
        } catch (err) {
            this.log.system.warn(`Annict legacy rule link import failed: ${this.errorMessage(err)}`);
            this.legacyRuleLinksImport = undefined;
        }
    }

    private async importLegacyRuleLinks(): Promise<void> {
        const markerFile = path.join(this.root, 'rule-links.db-imported.json');
        try {
            await fs.promises.access(markerFile);
            return;
        } catch (err: any) {
            if (err.code !== 'ENOENT') throw err;
        }

        const links = await this.readLegacyRuleLinks();
        const valid: LegacyAnnictRuleLink[] = [];
        for (const [rawRuleId, rawLink] of Object.entries(links)) {
            const ruleId = Number(rawRuleId);
            const annictId = typeof rawLink === 'number' ? rawLink : rawLink?.annictId;
            const viewerProfileId = typeof rawLink === 'number' ? undefined : rawLink?.viewerProfileId;
            if (!Number.isInteger(ruleId) || ruleId <= 0 || !Number.isInteger(annictId) || annictId <= 0) continue;
            if (
                viewerProfileId !== undefined &&
                (!Number.isInteger(viewerProfileId) || (viewerProfileId as number) <= 0)
            ) {
                continue;
            }
            // Old files can contain links for rules that were deleted before DB-backed cleanup existed.
            if ((await this.ruleDB.findId(ruleId)) === null) continue;
            valid.push({ ruleId, annictId, viewerProfileId });
        }
        const imported = await this.annictRuleLinkDB.insertLegacyIfMissing(valid);
        if (imported > 0) {
            this.log.system.info(
                `Imported ${imported} Annict rule link(s) from rule-links.json; the source file was preserved`,
            );
        }
        await this.writeJson(markerFile, { importedAt: Date.now(), imported });
    }

    private async readLegacyRuleLinks(): Promise<RuleLinksFile> {
        try {
            const value = JSON.parse(
                await fs.promises.readFile(path.join(this.root, 'rule-links.json'), 'utf8'),
            ) as RuleLinksFile;
            return value !== null && typeof value === 'object' ? value : {};
        } catch (err: any) {
            if (err.code === 'ENOENT') return {};
            throw err;
        }
    }

    private async readCache<T>(file: string): Promise<CacheFile<T> | null> {
        try {
            return JSON.parse(await fs.promises.readFile(file, 'utf8')) as CacheFile<T>;
        } catch (err: any) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    }

    private async writeJson(file: string, value: unknown): Promise<void> {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        await fs.promises.writeFile(temporary, JSON.stringify(value), 'utf8');
        await fs.promises.rename(temporary, file);
    }
}

export default AnnictApiModel;
