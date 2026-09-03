import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import BrokenImageOutlined from '@mui/icons-material/BrokenImageOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import DoneAll from '@mui/icons-material/DoneAll';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import PlaylistAddOutlined from '@mui/icons-material/PlaylistAddOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SelectAllOutlined from '@mui/icons-material/SelectAllOutlined';
import {
    Alert,
    Box,
    Button,
    Card,
    CardActionArea,
    CardContent,
    Checkbox,
    Chip,
    CircularProgress,
    Divider,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    Link,
    MenuItem,
    Select,
    SvgIcon,
    Stack,
    Switch,
    Tab,
    Tabs,
    TextField,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import type { AddRuleOption, AnnictProgram, AnnictWorkDetail, AnnictWorkSummary, RuleSearchOption } from '../../../api';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { PageSubHeader } from '../components/PageSubHeader';
import { RuleEditorDialog } from '../components/RuleEditorDialog';
import { api } from '../core/api/queries';
import { isPaidBroadcastChannel } from '../core/channels';
import { useAppBack } from '../core/navigation';
import { useNotifications } from '../core/notifications/Notifications';
import { rememberAppScrollPosition } from '../core/scrollRestoration';
import { useActiveUser } from '../core/storage/activeUser';
import { clearAnimeReturnPosition, type AnimeSortOrder, loadAnimeReturnPosition, loadAnimeSortOrder, saveAnimeReturnPosition, saveAnimeSortOrder } from '../core/storage/anime';
import { useSettings } from '../core/storage/settings';
import { useViewerProfile } from '../core/storage/viewerProfile';

type SeasonName = 'winter' | 'spring' | 'summer' | 'autumn';
const seasons: Array<{ value: SeasonName; label: string }> = [
    { value: 'winter', label: '冬' },
    { value: 'spring', label: '春' },
    { value: 'summer', label: '夏' },
    { value: 'autumn', label: '秋' },
];

function MdiCheckBoldIcon(): ReactNode {
    return (
        <SvgIcon>
            <path d="M9 21.035 3.965 16l2.125-2.125L9 16.785l8.91-8.91L20.035 10 9 21.035Z" />
        </SvgIcon>
    );
}

function currentSeason(): string {
    const now = new Date();
    now.setDate(now.getDate() + 7);
    const names: SeasonName[] = ['winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn'];
    return `${now.getFullYear()}-${names[now.getMonth()]}`;
}

function isSeasonName(value: string | null): value is SeasonName {
    return value !== null && seasons.some(season => season.value === value);
}

function parseSeasonYear(value: string | null): number | undefined {
    if (value === null || !/^\d{4}$/.test(value)) return undefined;
    const year = Number(value);
    return year >= 2000 && year <= 2100 ? year : undefined;
}

/**
 * Compare a return marker with the current anime list route.
 *
 * The history key is not stable when the detail page has to use the safe
 * replace fallback (for example after a direct/deep link).  The list query,
 * however, is stable enough to identify the list context.  Missing values are
 * accepted because the current season/mode are intentionally omitted from the
 * initial `/anime` URL.
 */
function isSameAnimeListContext(position: ReturnType<typeof loadAnimeReturnPosition>, pathname: string, search: string): boolean {
    if (position === null || pathname !== '/anime') return false;
    const params = new URLSearchParams(search);
    const mode = params.get('mode');
    const year = parseSeasonYear(params.get('year'));
    const season = params.get('season');
    if (position.mode !== undefined && mode !== null && (mode === 'rerun' ? 'rerun' : 'initial') !== position.mode) return false;
    if (year !== undefined && year !== position.year) return false;
    if (season !== null && isSeasonName(season) && season !== position.seasonName) return false;
    return true;
}

function releaseDateValue(value?: string): number {
    if (value === undefined) return Number.POSITIVE_INFINITY;
    const match = value.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (match === null) return Number.POSITIVE_INFINITY;
    return Date.UTC(Number(match[1]), Number(match[2] ?? 1) - 1, Number(match[3] ?? 1));
}

function workStartDateValue(work: AnnictWorkSummary): number {
    if (work.firstProgramStartedAt !== undefined) {
        const startedAt = Date.parse(work.firstProgramStartedAt);
        if (Number.isFinite(startedAt)) return startedAt;
    }
    return releaseDateValue(work.releasedOn ?? work.releasedOnAbout);
}

function localDateFromIso(value?: string): string | undefined {
    if (value === undefined) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    const year = date.getFullYear().toString(10).padStart(4, '0');
    const month = (date.getMonth() + 1).toString(10).padStart(2, '0');
    const day = date.getDate().toString(10).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const openSearchPeriodEndAt = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

function firstBroadcastSearchPeriods(work: Pick<AnnictWorkSummary, 'firstProgramStartedAt'>): RuleSearchOption['searchPeriods'] | undefined {
    const date = localDateFromIso(work.firstProgramStartedAt);
    if (date === undefined) return undefined;
    return [{ startAt: new Date(`${date}T00:00:00`).getTime(), endAt: openSearchPeriodEndAt }];
}

function Loading(): ReactNode {
    return (
        <Box sx={{ minHeight: 280, display: 'grid', placeItems: 'center' }}>
            <CircularProgress />
        </Box>
    );
}

function SetupRequired(): ReactNode {
    const navigate = useNavigate();
    return (
        <Alert severity="info" sx={{ m: { xs: 1.5, md: 3 } }} action={<Button onClick={() => void navigate('/settings')}>設定を開く</Button>}>
            Annictの読み取り専用アクセストークンを設定すると、アニメ作品と放送予定を表示できます。
        </Alert>
    );
}

function queryErrorMessage(error: Error): string {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data;
        if (typeof data === 'object' && data !== null && 'errors' in data && typeof (data as { errors?: unknown }).errors === 'string') {
            return (data as { errors: string }).errors;
        }
    }
    return error.message;
}

function AnimeWorkImage({
    imageUrl,
    title,
    fallbackAnnictId,
    onResolvedImageUrl,
}: {
    imageUrl?: string;
    title: string;
    fallbackAnnictId?: number;
    onResolvedImageUrl?: (imageUrl: string) => void;
}): ReactNode {
    const [activeImageUrl, setActiveImageUrl] = useState(imageUrl);
    const [failed, setFailed] = useState(false);
    const fallbackRequested = useRef(false);
    useEffect(() => {
        setActiveImageUrl(imageUrl);
        setFailed(false);
        fallbackRequested.current = false;
    }, [imageUrl]);
    const handleError = async (): Promise<void> => {
        if (fallbackAnnictId === undefined || fallbackRequested.current) {
            setFailed(true);
            return;
        }
        fallbackRequested.current = true;
        try {
            const detail = await api.getAnnictWork(fallbackAnnictId);
            if (detail.imageUrl !== undefined && detail.imageUrl !== activeImageUrl) {
                setActiveImageUrl(detail.imageUrl);
                onResolvedImageUrl?.(detail.imageUrl);
                setFailed(false);
                return;
            }
        } catch {
            // 画像の代替取得失敗はプレースホルダー表示へフォールバックする。
        }
        setFailed(true);
    };
    const visible = activeImageUrl !== undefined && !failed;
    return (
        <Box sx={{ width: '100%', aspectRatio: '16 / 9', position: 'relative', overflow: 'hidden', bgcolor: 'action.hover', display: 'grid', placeItems: 'center' }}>
            {!visible && <BrokenImageOutlined color="disabled" sx={{ fontSize: 48 }} />}
            {visible && (
                <Box
                    component="img"
                    src={activeImageUrl}
                    alt={`${title}の画像`}
                    draggable={false}
                    onError={() => void handleError()}
                    sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
            )}
        </Box>
    );
}

const seasonLabels: Record<string, string> = {
    winter: '冬',
    spring: '春',
    summer: '夏',
    autumn: '秋',
};

function stationKey(program: AnnictProgram): string {
    return program.channelAnnictId !== undefined ? `annict:${program.channelAnnictId}` : `name:${program.channelName.normalize('NFKC').toUpperCase()}`;
}

function bulkRuleSearchOption(work: AnnictWorkDetail): RuleSearchOption {
    const searchPeriods = firstBroadcastSearchPeriods(work);
    const firstByStation = new Map<string, AnnictProgram>();
    work.programs
        .filter(program => program.localChannels.length > 0 && Date.parse(program.startedAt) >= Date.now())
        .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
        .forEach(program => {
            const key = stationKey(program);
            if (!firstByStation.has(key)) firstByStation.set(key, program);
        });
    const programs = [...firstByStation.values()];
    if (programs.length === 0) {
        return {
            keyword: work.title,
            name: true,
            description: false,
            extended: false,
            times: [{ week: 0x7f }],
            searchPeriods,
        };
    }
    const channelIds = Array.from(new Set(programs.flatMap(program => program.localChannels.map(channel => channel.id))));
    const week = programs.reduce((value, program) => value | (1 << new Date(program.startedAt).getDay()), 0);
    return {
        keyword: work.title,
        name: true,
        description: false,
        extended: false,
        channelIds,
        times: [{ week: week === 0 ? 0x7f : week }],
        searchPeriods,
    };
}

function programDate(program: AnnictProgram): string {
    return new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(program.startedAt));
}

function episodeText(program: AnnictProgram): string | null {
    const number =
        program.episodeNumberText ?? (program.episodeNumber !== undefined ? `第${program.episodeNumber}話${program.episodeNumberEstimated === true ? '（予定）' : ''}` : undefined);
    const result = [number, program.episodeTitle].filter((value): value is string => value !== undefined).join(' ');
    if (result.length === 0 && !program.rebroadcast) return null;
    return `${result}${program.rebroadcast ? '（再）' : ''}`;
}

function InfoItem({ label, children }: { label: string; children: ReactNode }): ReactNode {
    return (
        <Box>
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
            <Typography component="div" variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                {children}
            </Typography>
        </Box>
    );
}

function ExternalInfoLink({ href, children }: { href: string; children: ReactNode }): ReactNode {
    return (
        <Link href={href} target="_blank" rel="noreferrer">
            {children}
        </Link>
    );
}

function linkHost(value: string): string {
    try {
        return new URL(value).hostname;
    } catch {
        return value;
    }
}

function WorkInformation({ work }: { work: AnnictWorkDetail }): ReactNode {
    const season =
        work.seasonYear !== undefined && work.seasonName !== undefined ? `${work.seasonYear}年${seasonLabels[work.seasonName.toLowerCase()] ?? work.seasonName}` : undefined;
    const twitterUsername = work.twitterUsername?.replace(/^@/, '');
    const twitterHashtag = work.twitterHashtag?.replace(/^#/, '');
    return (
        <Stack spacing={2} sx={{ py: 2 }}>
            {work.synopsis !== undefined && (
                <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.75 }}>
                        あらすじ
                    </Typography>
                    <Typography sx={{ whiteSpace: 'pre-line' }}>{work.synopsis}</Typography>
                    {work.synopsisSource !== undefined && (
                        <Typography variant="caption" color="text.secondary">
                            引用元: <ExternalInfoLink href={work.synopsisSource}>{work.synopsisSource}</ExternalInfoLink>
                        </Typography>
                    )}
                </Box>
            )}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
                    gap: 2,
                    p: 2,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                }}
            >
                {work.titleKana !== undefined && <InfoItem label="タイトル（かな）">{work.titleKana}</InfoItem>}
                {work.titleEn !== undefined && <InfoItem label="タイトル（英）">{work.titleEn}</InfoItem>}
                {work.media !== undefined && <InfoItem label="メディア">{work.media}</InfoItem>}
                {season !== undefined && <InfoItem label="リリース時期">{season}</InfoItem>}
                {(work.releasedOnAbout ?? work.releasedOn) !== undefined && <InfoItem label="放送開始日">{work.releasedOnAbout ?? work.releasedOn}</InfoItem>}
                {work.officialSiteUrl !== undefined && (
                    <InfoItem label="公式サイト">
                        <ExternalInfoLink href={work.officialSiteUrl}>{linkHost(work.officialSiteUrl)}</ExternalInfoLink>
                    </InfoItem>
                )}
                {work.officialSiteUrlEn !== undefined && (
                    <InfoItem label="公式サイト（英）">
                        <ExternalInfoLink href={work.officialSiteUrlEn}>{linkHost(work.officialSiteUrlEn)}</ExternalInfoLink>
                    </InfoItem>
                )}
                {twitterUsername !== undefined && (
                    <InfoItem label="公式Twitter">
                        <ExternalInfoLink href={`https://x.com/${encodeURIComponent(twitterUsername)}`}>@{twitterUsername}</ExternalInfoLink>
                    </InfoItem>
                )}
                {twitterHashtag !== undefined && (
                    <InfoItem label="ハッシュタグ">
                        <ExternalInfoLink href={`https://x.com/hashtag/${encodeURIComponent(twitterHashtag)}`}>#{twitterHashtag}</ExternalInfoLink>
                    </InfoItem>
                )}
                {work.wikipediaUrl !== undefined && (
                    <InfoItem label="Wikipedia">
                        <ExternalInfoLink href={work.wikipediaUrl}>日本語</ExternalInfoLink>
                    </InfoItem>
                )}
                {work.wikipediaUrlEn !== undefined && (
                    <InfoItem label="Wikipedia（英）">
                        <ExternalInfoLink href={work.wikipediaUrlEn}>English</ExternalInfoLink>
                    </InfoItem>
                )}
                {work.syobocalTid !== undefined && (
                    <InfoItem label="しょぼいカレンダー">
                        <ExternalInfoLink href={`https://cal.syoboi.jp/tid/${work.syobocalTid}`}>{work.syobocalTid}</ExternalInfoLink>
                    </InfoItem>
                )}
                {work.malAnimeId !== undefined && (
                    <InfoItem label="MyAnimeList">
                        <ExternalInfoLink href={`https://myanimelist.net/anime/${work.malAnimeId}`}>{work.malAnimeId}</ExternalInfoLink>
                    </InfoItem>
                )}
            </Box>
        </Stack>
    );
}

function WorkCasts({ work }: { work: AnnictWorkDetail }): ReactNode {
    if (work.casts.length === 0)
        return (
            <Alert severity="info" sx={{ my: 2 }}>
                キャスト情報は登録されていません。
            </Alert>
        );
    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, borderTop: 1, borderColor: 'divider', my: 1 }}>
            {work.casts.map(cast => (
                <Box key={cast.annictId} sx={{ py: 1.25, pr: { md: 2 }, borderBottom: 1, borderColor: 'divider', minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700 }}>{cast.characterName ?? cast.name}</Typography>
                    {(cast.personName !== undefined || cast.characterName !== undefined) && <Typography color="text.secondary">{cast.personName ?? cast.name}</Typography>}
                </Box>
            ))}
        </Box>
    );
}

function WorkStaffs({ work }: { work: AnnictWorkDetail }): ReactNode {
    if (work.staffs.length === 0)
        return (
            <Alert severity="info" sx={{ my: 2 }}>
                スタッフ情報は登録されていません。
            </Alert>
        );
    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, borderTop: 1, borderColor: 'divider', my: 1 }}>
            {work.staffs.map(staff => (
                <Box key={staff.annictId} sx={{ py: 1.25, pr: { md: 2 }, borderBottom: 1, borderColor: 'divider', minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700 }}>{staff.name}</Typography>
                    {staff.role !== undefined && <Typography color="text.secondary">{staff.role}</Typography>}
                </Box>
            ))}
        </Box>
    );
}

function ProgramCard({ program, selected, onToggle }: { program: AnnictProgram; selected?: boolean; onToggle?: () => void }): ReactNode {
    const details = episodeText(program);
    const content = (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            {onToggle !== undefined && <Checkbox checked={selected === true} tabIndex={-1} disableRipple />}
            <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700 }}>{program.channelName}</Typography>
                <Typography>{programDate(program)}</Typography>
                {program.firstBroadcast === true && <Chip size="small" color="primary" variant="outlined" label="初回放送" sx={{ mr: 0.75 }} />}
                {details !== null && <Typography color="text.secondary">{details}</Typography>}
            </Box>
        </Stack>
    );
    return (
        <Card variant="outlined">
            {onToggle === undefined ? (
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>{content}</CardContent>
            ) : (
                <CardActionArea component="div" role="checkbox" aria-checked={selected === true} onClick={onToggle}>
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>{content}</CardContent>
                </CardActionArea>
            )}
        </Card>
    );
}

export function AnimePage(): ReactNode {
    const navigate = useNavigate();
    const location = useLocation();
    const navigationType = useNavigationType();
    const { notify } = useNotifications();
    const [params, setParams] = useSearchParams();
    const queryClient = useQueryClient();
    const activeUser = useActiveUser();
    const settings = useSettings();
    const now = currentSeason();
    const parsedFocusAnnictId = Number(params.get('focus'));
    const focusAnnictId = Number.isInteger(parsedFocusAnnictId) && parsedFocusAnnictId > 0 ? parsedFocusAnnictId : null;
    const returnPosition = useMemo(loadAnimeReturnPosition, [location.key]);
    const sameListContext = isSameAnimeListContext(returnPosition, location.pathname, location.search);
    const restoredPosition = focusAnnictId !== null && returnPosition?.annictId === focusAnnictId && sameListContext ? returnPosition : null;
    // A normal browser back restores the exact list history entry. A safe
    // replace fallback has a new key, but carries focus and is handled above.
    const listReturnPosition =
        navigationType === 'POP' && sameListContext && returnPosition?.listLocationKey === location.key && returnPosition.scrollY !== undefined ? returnPosition : null;
    const scrollReturnPosition = restoredPosition?.scrollY !== undefined ? restoredPosition : listReturnPosition;
    const savedScrollY = scrollReturnPosition?.scrollY;
    const initialPosition = restoredPosition ?? listReturnPosition;
    const yearParam = parseSeasonYear(params.get('year'));
    const seasonParam = params.get('season');
    const [year, setYear] = useState(yearParam ?? initialPosition?.year ?? Number(now.slice(0, 4)));
    const [seasonName, setSeasonName] = useState<SeasonName>(
        isSeasonName(seasonParam) ? seasonParam : ((initialPosition?.seasonName as SeasonName | undefined) ?? (now.split('-')[1] as SeasonName)),
    );
    const [showNonTv, setShowNonTv] = useState(initialPosition?.showNonTv ?? false);
    const [watchingOnly, setWatchingOnly] = useState(initialPosition?.watchingOnly ?? false);
    const [filterKeyword, setFilterKeyword] = useState(initialPosition?.filterKeyword ?? '');
    const [sortOrder, setSortOrder] = useState<AnimeSortOrder>(loadAnimeSortOrder);
    const [mode, setMode] = useState<'initial' | 'rerun'>(params.get('mode') === 'rerun' ? 'rerun' : 'initial');
    const [resolvedImageUrls, setResolvedImageUrls] = useState<Record<number, string>>({});
    const restoredFocusRef = useRef<number | null>(null);
    const viewerProfile = useViewerProfile();
    const season = `${year}-${seasonName}`;
    const status = useQuery({
        queryKey: ['annict', 'status', viewerProfile.profileId, viewerProfile.sessionToken],
        queryFn: api.getAnnictStatus,
    });
    const writeAvailable = status.data?.writeConfigured === true;
    const works = useQuery({
        queryKey: ['annict', 'works', season, mode],
        queryFn: () => api.getAnnictWorks(season, false, mode === 'rerun'),
        enabled: status.data?.configured === true,
    });
    const viewerStatusIds = useMemo(() => works.data?.works.map(work => work.annictId) ?? [], [works.data?.works]);
    const viewerStatuses = useQuery({
        queryKey: ['annict', 'viewer-statuses', viewerProfile.profileId, viewerProfile.sessionToken, viewerStatusIds.join(',')],
        queryFn: () => api.getAnnictViewerStatuses(viewerStatusIds),
        enabled: writeAvailable && viewerStatusIds.length > 0,
        staleTime: 30_000,
    });
    const viewerStatusMap = useMemo(() => new Map(viewerStatuses.data?.statuses.map(item => [item.annictId, item.kind]) ?? []), [viewerStatuses.data?.statuses]);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedWorkIds, setSelectedWorkIds] = useState<Set<number>>(() => new Set());
    const [bulkRuleConfirmOpen, setBulkRuleConfirmOpen] = useState(false);
    const markWatched = useMutation({
        mutationFn: (annictIds: number[]) => api.setAnnictViewerStatuses(annictIds, 'watched'),
        onSuccess: async (_data, annictIds) => {
            await queryClient.invalidateQueries({ queryKey: ['annict', 'viewer-statuses'] });
            setSelectedWorkIds(new Set());
            setSelectionMode(false);
            notify(`${annictIds.length}作品を「見た」に更新しました`, 'success');
        },
        onError: error => notify(`Annictの視聴ステータスを更新できませんでした: ${error.message}`, 'error'),
    });
    const addSelectedRules = useMutation({
        mutationFn: async (annictIds: number[]) => {
            if (typeof activeUser !== 'number') throw new Error('設定画面でアクティブユーザーを選択してください');
            const uniqueAnnictIds = [...new Set(annictIds)];
            const rulePageSize = 1000;
            const firstRulePage = await api.getRules({ type: 'normal', userId: activeUser, offset: 0, limit: rulePageSize });
            const existingRules = [...firstRulePage.rules];
            for (let offset = rulePageSize; offset < firstRulePage.total; offset += rulePageSize) {
                const rulePage = await api.getRules({ type: 'normal', userId: activeUser, offset, limit: rulePageSize });
                existingRules.push(...rulePage.rules);
            }
            const existingAnnictIds = new Set(existingRules.flatMap(rule => (rule.annictId === undefined ? [] : [rule.annictId])));
            const pendingAnnictIds = uniqueAnnictIds.filter(annictId => !existingAnnictIds.has(annictId));
            const alreadyAdded = uniqueAnnictIds.length - pendingAnnictIds.length;
            const config = await api.getConfig();
            const details: AnnictWorkDetail[] = [];
            const detailFailures: string[] = [];
            for (let index = 0; index < pendingAnnictIds.length; index += 4) {
                const batchIds = pendingAnnictIds.slice(index, index + 4);
                const batch = await Promise.allSettled(batchIds.map(annictId => api.getAnnictWork(annictId)));
                batch.forEach((result, offset) => {
                    if (result.status === 'fulfilled') details.push(result.value);
                    else {
                        const work = works.data?.works.find(item => item.annictId === batchIds[offset]);
                        detailFailures.push(work?.title ?? `Annict ID ${batchIds[offset]}`);
                    }
                });
            }

            const failed = [...detailFailures];
            const linkWarnings: string[] = [];
            let created = 0;
            for (const detail of details) {
                const searchOption = bulkRuleSearchOption(detail);
                const directory = settings.isEnableCopyKeywordToDirectory ? detail.title : undefined;
                const mode = settings.isEnableEncodingSettingWhenCreateRule ? config.encode[0] : undefined;
                const option: AddRuleOption = {
                    isTimeSpecification: false,
                    userId: activeUser,
                    searchOption,
                    reserveOption: {
                        enable: true,
                        allowEndLack: true,
                        avoidDuplicate: settings.isCheckAvoidDuplicate,
                    },
                    saveOption: directory === undefined ? undefined : { directory },
                    encodeOption:
                        mode === undefined
                            ? undefined
                            : {
                                  mode1: mode,
                                  directory1: directory,
                                  isDeleteOriginalAfterEncode: settings.isCheckDeleteOriginalAfterEncode,
                                  updateThumbnail: false,
                              },
                };
                try {
                    const ruleId = await api.addRule(option);
                    created++;
                    try {
                        await api.linkAnnictRule(ruleId, detail.annictId);
                    } catch {
                        if (viewerProfile.profileId !== null && writeAvailable) linkWarnings.push(detail.title);
                    }
                } catch {
                    failed.push(detail.title);
                }
            }
            return { requested: uniqueAnnictIds.length, created, alreadyAdded, failed, linkWarnings };
        },
        onSuccess: async result => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['rules'] }),
                queryClient.invalidateQueries({ queryKey: ['reserves'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-counts'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
                queryClient.invalidateQueries({ queryKey: ['annict', 'viewer-statuses'] }),
            ]);
            const notes = [
                result.alreadyAdded > 0 ? `追加済み ${result.alreadyAdded}件` : '',
                result.failed.length > 0 ? `追加失敗 ${result.failed.length}件` : '',
                result.linkWarnings.length > 0 ? `Annict連携警告 ${result.linkWarnings.length}件` : '',
            ].filter(Boolean);
            notify(
                `${result.created}/${result.requested}作品のルールを追加しました${notes.length > 0 ? `（${notes.join('、')}）` : ''}`,
                result.created < result.requested || result.linkWarnings.length > 0 ? 'warning' : 'success',
            );
            setBulkRuleConfirmOpen(false);
            setSelectionMode(false);
            setSelectedWorkIds(new Set());
        },
        onError: error => notify(`一括ルール追加に失敗しました: ${error.message}`, 'error'),
    });

    useEffect(() => {
        if (!writeAvailable && watchingOnly) setWatchingOnly(false);
    }, [watchingOnly, writeAvailable]);

    const years = useMemo(() => Array.from({ length: 7 }, (_, index) => new Date().getFullYear() + 1 - index), []);
    const visibleWorks = useMemo(() => {
        const keyword = filterKeyword.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
        const filtered =
            works.data?.works.filter(work => {
                if (!showNonTv && work.media !== 'TV') return false;
                if (watchingOnly && writeAvailable && viewerStatuses.error === null && viewerStatusMap.get(work.annictId) !== 'watching') return false;
                if (keyword.length === 0) return true;
                return [work.title, work.titleKana]
                    .filter((value): value is string => value !== undefined)
                    .some(value => value.normalize('NFKC').toLocaleLowerCase('ja-JP').includes(keyword));
            }) ?? [];
        return [...filtered].sort((left, right) => {
            if (sortOrder === 'release-date') {
                const leftDate = workStartDateValue(left);
                const rightDate = workStartDateValue(right);
                if (leftDate !== rightDate) return leftDate - rightDate;
            }
            const popularityDifference = (right.watchersCount ?? -1) - (left.watchersCount ?? -1);
            return popularityDifference !== 0 ? popularityDifference : left.title.localeCompare(right.title, 'ja');
        });
    }, [filterKeyword, showNonTv, sortOrder, viewerStatuses.error, viewerStatusMap, watchingOnly, works.data?.works, writeAvailable]);

    const toggleWorkSelection = (annictId: number): void => {
        setSelectedWorkIds(current => {
            const next = new Set(current);
            if (next.has(annictId)) next.delete(annictId);
            else next.add(annictId);
            return next;
        });
    };

    const finishSelectionMode = (): void => {
        setSelectionMode(false);
        setSelectedWorkIds(new Set());
    };

    const changeSortOrder = (value: AnimeSortOrder): void => {
        setSortOrder(value);
        saveAnimeSortOrder(value);
    };

    const changeSeason = (nextYear: number, nextSeasonName: SeasonName): void => {
        setYear(nextYear);
        setSeasonName(nextSeasonName);
        const nextParams = new URLSearchParams(params);
        nextParams.set('year', String(nextYear));
        nextParams.set('season', nextSeasonName);
        nextParams.delete('focus');
        setParams(nextParams, { replace: true });
    };

    const changeMode = (): void => {
        const nextMode = mode === 'initial' ? 'rerun' : 'initial';
        const nextParams = new URLSearchParams(params);
        if (nextMode === 'rerun') nextParams.set('mode', 'rerun');
        else nextParams.delete('mode');
        setMode(nextMode);
        setParams(nextParams, { replace: true });
    };

    useEffect(() => {
        if (focusAnnictId === null || works.isPending || savedScrollY !== undefined || restoredFocusRef.current === focusAnnictId) return;
        restoredFocusRef.current = focusAnnictId;
        const frame = window.requestAnimationFrame(() => {
            const card = document.querySelector<HTMLElement>(`[data-anime-work-id="${focusAnnictId}"]`);
            if (card !== null) card.scrollIntoView({ block: 'center' });
            else window.scrollTo({ top: 0 });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [focusAnnictId, savedScrollY, visibleWorks, works.isPending]);

    useEffect(() => {
        if (savedScrollY === undefined || works.data === undefined) return;
        let cancelled = false;
        let frame = 0;
        let attempts = 0;
        const startedAt = performance.now();
        const restoreCardId = scrollReturnPosition?.annictId;
        const restore = (): void => {
            if (cancelled) return;
            window.scrollTo({ top: savedScrollY, behavior: 'auto' });
            const card = restoreCardId === undefined ? null : document.querySelector<HTMLElement>(`[data-anime-work-id="${restoreCardId}"]`);
            const anchorTop = scrollReturnPosition?.anchorTop;
            if (card !== null && anchorTop !== undefined) {
                const correction = card.getBoundingClientRect().top - anchorTop;
                if (Math.abs(correction) > 1) window.scrollTo({ top: Math.max(0, window.scrollY + correction), behavior: 'auto' });
            }
            const positionReached =
                card !== null && anchorTop !== undefined ? Math.abs(card.getBoundingClientRect().top - anchorTop) <= 1 : Math.abs(window.scrollY - savedScrollY) <= 1;
            const restoreComplete = positionReached && card !== null;
            const timedOut = performance.now() - startedAt >= 10_000;
            // The list can be painted over several frames after a cached query
            // resolves. Keep applying the saved position until the document can
            // actually hold it. This also prevents AppLayout's generic POP
            // restoration from winning a race with the anime-specific marker.
            if (!restoreComplete && !timedOut && attempts < 600) {
                attempts++;
                frame = window.requestAnimationFrame(restore);
                return;
            }
            if (!restoreComplete && card !== null) card.scrollIntoView({ block: 'center', behavior: 'auto' });
            clearAnimeReturnPosition();
        };
        frame = window.requestAnimationFrame(restore);
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame);
        };
    }, [savedScrollY, scrollReturnPosition?.annictId, works.data, visibleWorks.length]);

    return (
        <>
            <PageHeader
                title={
                    <Button
                        color="inherit"
                        onClick={changeMode}
                        sx={{
                            display: { xs: selectionMode ? 'none' : 'inline-flex', md: 'inline-flex' },
                            minWidth: 0,
                            px: 1,
                            fontSize: '1.25rem',
                            fontWeight: 500,
                            textTransform: 'none',
                        }}
                    >
                        {mode === 'initial' ? 'アニメ（初）' : 'アニメ（再）'}
                    </Button>
                }
                actions={
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        {selectionMode && (
                            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', whiteSpace: 'nowrap' }}>
                                <Typography variant="body2">
                                    {selectedWorkIds.size}件
                                    <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
                                        選択
                                    </Box>
                                </Typography>
                                <Button
                                    size="small"
                                    startIcon={<SelectAllOutlined />}
                                    onClick={() => setSelectedWorkIds(new Set(visibleWorks.map(work => work.annictId)))}
                                    sx={{ minWidth: { xs: 34, md: 'auto' }, px: { xs: 0.5, md: 1 }, '& .MuiButton-startIcon': { mr: { xs: 0, md: 0.5 } } }}
                                    aria-label="表示中を全選択"
                                >
                                    <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
                                        表示中を全選択
                                    </Box>
                                </Button>
                                <Button size="small" onClick={() => setSelectedWorkIds(new Set())} sx={{ minWidth: 0, px: { xs: 0.5, md: 1 } }}>
                                    解除
                                </Button>
                                <Button
                                    size="small"
                                    variant="contained"
                                    startIcon={<MdiCheckBoldIcon />}
                                    disabled={!writeAvailable || selectedWorkIds.size === 0 || markWatched.isPending}
                                    onClick={() => markWatched.mutate([...selectedWorkIds])}
                                    sx={{ minWidth: { xs: 34, md: 'auto' }, px: { xs: 0.5, md: 1 }, '& .MuiButton-startIcon': { mr: { xs: 0, md: 0.5 } } }}
                                    aria-label={writeAvailable ? '選択した作品を見たにする' : 'Annict書き込み連携が必要です'}
                                >
                                    <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
                                        「見た」にする
                                    </Box>
                                </Button>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<PlaylistAddOutlined />}
                                    disabled={selectedWorkIds.size === 0 || addSelectedRules.isPending}
                                    onClick={() => setBulkRuleConfirmOpen(true)}
                                    sx={{ minWidth: { xs: 34, md: 'auto' }, px: { xs: 0.5, md: 1 }, '& .MuiButton-startIcon': { mr: { xs: 0, md: 0.5 } } }}
                                    aria-label="選択した作品のルールを一括追加"
                                >
                                    <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
                                        ルール追加
                                    </Box>
                                </Button>
                            </Stack>
                        )}
                        <Button
                            color="inherit"
                            startIcon={<DoneAll />}
                            disabled={works.data === undefined}
                            onClick={() => {
                                if (selectionMode) finishSelectionMode();
                                else setSelectionMode(true);
                            }}
                            sx={{ whiteSpace: 'nowrap' }}
                        >
                            <Box component="span" sx={{ display: { xs: selectionMode ? 'none' : 'inline', md: 'inline' } }}>
                                {selectionMode ? '選択終了' : '一括選択'}
                            </Box>
                        </Button>
                        <IconButton
                            aria-label="更新"
                            disabled={!works.data}
                            onClick={() =>
                                void queryClient.fetchQuery({
                                    queryKey: ['annict', 'works', season, mode],
                                    queryFn: () => api.getAnnictWorks(season, true, mode === 'rerun'),
                                })
                            }
                        >
                            <RefreshOutlined />
                        </IconButton>
                    </Stack>
                }
            />
            <Dialog
                open={bulkRuleConfirmOpen}
                onClose={() => {
                    if (!addSelectedRules.isPending) setBulkRuleConfirmOpen(false);
                }}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>ルールを一括追加</DialogTitle>
                <DialogContent>
                    <Typography>
                        選択した{selectedWorkIds.size}
                        作品について、受信可能な放送局と曜日を使ったルールを作品ごとに追加します。今後の受信可能な放送予定がない作品は、作品名のみ・全局・全曜日のルールを追加します。同じAnnict作品のルールが既にある作品はスキップします。
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button disabled={addSelectedRules.isPending} onClick={() => setBulkRuleConfirmOpen(false)}>
                        キャンセル
                    </Button>
                    <Button variant="contained" disabled={selectedWorkIds.size === 0 || addSelectedRules.isPending} onClick={() => addSelectedRules.mutate([...selectedWorkIds])}>
                        {addSelectedRules.isPending ? '追加中…' : '追加'}
                    </Button>
                </DialogActions>
            </Dialog>
            {status.isPending ? (
                <Loading />
            ) : status.isError ? (
                <Alert severity="error" sx={{ m: { xs: 1.5, md: 3 } }} action={<Button onClick={() => void status.refetch()}>再試行</Button>}>
                    Annict連携状態を取得できません: {status.error.message}
                </Alert>
            ) : status.data?.configured !== true ? (
                <SetupRequired />
            ) : (
                <>
                    <PageSubHeader>
                        <Stack spacing={1} sx={{ px: { xs: 1.5, md: 3 }, py: 1.5 }}>
                            <Box
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: {
                                        xs: 'repeat(3, minmax(0, 1fr))',
                                        md: '110px 110px 150px minmax(220px, 320px) auto',
                                    },
                                    gap: 1,
                                    alignItems: 'center',
                                    justifyContent: 'start',
                                }}
                            >
                                <FormControl size="small" sx={{ minWidth: 0 }}>
                                    <InputLabel>年</InputLabel>
                                    <Select label="年" value={year} onChange={event => changeSeason(Number(event.target.value), seasonName)}>
                                        {years.map(item => (
                                            <MenuItem key={item} value={item}>
                                                {item}年
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <FormControl size="small" sx={{ minWidth: 0 }}>
                                    <InputLabel>クール</InputLabel>
                                    <Select label="クール" value={seasonName} onChange={event => changeSeason(year, event.target.value as SeasonName)}>
                                        {seasons.map(item => (
                                            <MenuItem key={item.value} value={item.value}>
                                                {item.label}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <FormControl size="small" sx={{ minWidth: 0 }}>
                                    <InputLabel>並び順</InputLabel>
                                    <Select label="並び順" value={sortOrder} onChange={event => changeSortOrder(event.target.value as AnimeSortOrder)}>
                                        <MenuItem value="popularity">人気順</MenuItem>
                                        <MenuItem value="release-date">放送開始日順</MenuItem>
                                    </Select>
                                </FormControl>
                                <TextField
                                    size="small"
                                    label="作品名を絞り込み"
                                    value={filterKeyword}
                                    onChange={event => setFilterKeyword(event.target.value)}
                                    sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, minWidth: 0 }}
                                />
                                <Stack direction="row" spacing={0.5} useFlexGap sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, alignItems: 'center', whiteSpace: 'nowrap' }}>
                                    <FormControlLabel
                                        control={<Switch checked={watchingOnly} onChange={event => setWatchingOnly(event.target.checked)} />}
                                        label="視聴中"
                                        disabled={!writeAvailable}
                                        sx={{ mr: 0.5 }}
                                    />
                                    <FormControlLabel
                                        control={<Switch checked={showNonTv} onChange={event => setShowNonTv(event.target.checked)} />}
                                        label="劇場・Web作品"
                                        sx={{ mr: 0 }}
                                    />
                                </Stack>
                            </Box>
                        </Stack>
                    </PageSubHeader>
                    <Stack spacing={2} sx={{ p: { xs: 1.5, md: 3 } }}>
                        {works.data?.stale === true && <Alert severity="warning">Annictへ接続できなかったため、保存済みデータを表示しています。</Alert>}
                        {viewerStatuses.error !== null && writeAvailable && (
                            <Alert severity="warning">Annictの視聴ステータスを取得できませんでした。作品一覧はそのまま利用できます。</Alert>
                        )}
                        {works.isPending || (watchingOnly && writeAvailable && viewerStatuses.isPending) ? (
                            <Loading />
                        ) : works.error !== null ? (
                            <Alert severity="error">{queryErrorMessage(works.error)}</Alert>
                        ) : visibleWorks.length === 0 ? (
                            <Alert severity="info">条件に一致する作品はありません。</Alert>
                        ) : (
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5 }}>
                                {visibleWorks.map(work => {
                                    const selected = selectedWorkIds.has(work.annictId);
                                    return (
                                        <Card
                                            variant="outlined"
                                            key={work.annictId}
                                            data-anime-work-id={work.annictId}
                                            sx={{
                                                ...(selectionMode && {
                                                    borderColor: selected ? 'primary.main' : 'divider',
                                                    bgcolor: selected ? 'action.selected' : undefined,
                                                    outline: selected ? 2 : 0,
                                                    outlineColor: 'primary.main',
                                                    outlineOffset: -2,
                                                }),
                                            }}
                                        >
                                            <CardActionArea
                                                onClick={event => {
                                                    if (selectionMode) {
                                                        toggleWorkSelection(work.annictId);
                                                        return;
                                                    }
                                                    const card = event.currentTarget.closest('[data-anime-work-id]');
                                                    const anchorTop = card?.getBoundingClientRect().top;
                                                    rememberAppScrollPosition(location.key, window.scrollY);
                                                    saveAnimeReturnPosition({
                                                        annictId: work.annictId,
                                                        year,
                                                        seasonName,
                                                        showNonTv,
                                                        watchingOnly,
                                                        filterKeyword,
                                                        mode,
                                                        scrollY: window.scrollY,
                                                        listLocationKey: location.key,
                                                        ...(anchorTop === undefined || !Number.isFinite(anchorTop) ? {} : { anchorTop }),
                                                    });
                                                    const detailParams = new URLSearchParams({ mode, year: String(year), season: seasonName });
                                                    void navigate(`/anime/${work.annictId}?${detailParams.toString()}`, {
                                                        state: { imageUrl: resolvedImageUrls[work.annictId] ?? work.imageUrl, mode, fromAnimeList: true },
                                                    });
                                                }}
                                                onDragStart={event => event.preventDefault()}
                                                sx={{
                                                    height: '100%',
                                                    ...(selectionMode && {
                                                        cursor: 'pointer',
                                                        userSelect: 'none',
                                                        WebkitUserSelect: 'none',
                                                        WebkitTouchCallout: 'none',
                                                        touchAction: 'manipulation',
                                                    }),
                                                }}
                                                role={selectionMode ? 'checkbox' : undefined}
                                                aria-checked={selectionMode ? selected : undefined}
                                            >
                                                <AnimeWorkImage
                                                    imageUrl={work.imageUrl}
                                                    title={work.title}
                                                    fallbackAnnictId={work.annictId}
                                                    onResolvedImageUrl={imageUrl =>
                                                        setResolvedImageUrls(current => (current[work.annictId] === imageUrl ? current : { ...current, [work.annictId]: imageUrl }))
                                                    }
                                                />
                                                <CardContent>
                                                    {selectionMode && (
                                                        <Checkbox
                                                            checked={selected}
                                                            tabIndex={-1}
                                                            disableRipple
                                                            aria-hidden
                                                            sx={{ float: 'right', mt: -1, mr: -1, pointerEvents: 'none' }}
                                                        />
                                                    )}
                                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                        {work.title}
                                                    </Typography>
                                                    <Stack direction="row" spacing={0.75} sx={{ mt: 1 }}>
                                                        {work.media && <Chip size="small" label={work.media} />}
                                                        {work.watchersCount !== undefined && <Chip size="small" variant="outlined" label={`${work.watchersCount}人`} />}
                                                    </Stack>
                                                </CardContent>
                                            </CardActionArea>
                                        </Card>
                                    );
                                })}
                            </Box>
                        )}
                    </Stack>
                </>
            )}
        </>
    );
}

export function AnimeDetailPage(): ReactNode {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const settings = useSettings();
    const annictId = Number(useParams().annictId);
    const [ruleOpen, setRuleOpen] = useState(false);
    const [detailTab, setDetailTab] = useState(0);
    const [showAllPrograms, setShowAllPrograms] = useState(false);
    const [selectedStationKeys, setSelectedStationKeys] = useState<Set<string>>(() => new Set());
    const [selectedSupplementalChannelIds, setSelectedSupplementalChannelIds] = useState<Set<number>>(() => new Set());
    const [selectionSource, setSelectionSource] = useState('');
    const work = useQuery({ queryKey: ['annict', 'work', annictId], queryFn: () => api.getAnnictWork(annictId), enabled: Number.isFinite(annictId) });
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig, staleTime: Number.POSITIVE_INFINITY });
    const channels = useQuery({
        queryKey: ['channels'],
        queryFn: api.getChannels,
        enabled: config.data?.developerMode === true && settings.annictSupplementalChannelIds.length > 0,
    });
    const detailState = location.state as { imageUrl?: string; mode?: 'initial' | 'rerun'; fromAnimeList?: boolean } | null;
    const listImageUrl = detailState?.imageUrl;
    const mode = searchParams.get('mode') === 'rerun' || detailState?.mode === 'rerun' ? 'rerun' : 'initial';
    const returnYear = parseSeasonYear(searchParams.get('year'));
    const returnSeason = searchParams.get('season');
    const backParams = new URLSearchParams({ mode, focus: String(annictId) });
    if (returnYear !== undefined) backParams.set('year', String(returnYear));
    if (isSeasonName(returnSeason)) backParams.set('season', returnSeason);
    const goBack = useAppBack(`/anime?${backParams.toString()}`);
    const receivable = useMemo(
        () =>
            work.data?.programs.filter(
                program =>
                    program.localChannels.length > 0 &&
                    Date.parse(program.startedAt) >= Date.now() &&
                    (!settings.annictExcludePaidChannels || !isPaidBroadcastChannel({ name: program.channelName })),
            ) ?? [],
        [settings.annictExcludePaidChannels, work.data?.programs],
    );
    const supplementalChannels = useMemo(() => {
        if (config.data?.developerMode !== true) return [];
        const scheduledChannelIds = new Set(receivable.flatMap(program => program.localChannels.map(channel => channel.id)));
        return (channels.data ?? []).filter(
            channel =>
                settings.annictSupplementalChannelIds.includes(channel.id) &&
                !scheduledChannelIds.has(channel.id) &&
                (!settings.annictExcludePaidChannels || !isPaidBroadcastChannel(channel)),
        );
    }, [channels.data, config.data?.developerMode, receivable, settings.annictExcludePaidChannels, settings.annictSupplementalChannelIds]);
    const { firstPrograms, additionalPrograms } = useMemo(() => {
        const groups = new Map<string, AnnictProgram[]>();
        receivable.forEach(program => {
            const key = stationKey(program);
            const items = groups.get(key) ?? [];
            items.push(program);
            groups.set(key, items);
        });
        const first: AnnictProgram[] = [];
        const additional: AnnictProgram[] = [];
        groups.forEach(programs => {
            programs.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
            if (programs[0] !== undefined) first.push(programs[0]);
            additional.push(...programs.slice(1));
        });
        return {
            firstPrograms: first.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
            additionalPrograms: additional.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
        };
    }, [receivable]);
    const selectionSignature = firstPrograms.map(program => `${stationKey(program)}:${program.annictId}`).join('|');

    useEffect(() => {
        if (selectionSource === selectionSignature) return;
        setSelectedStationKeys(new Set(firstPrograms.map(stationKey)));
        setSelectionSource(selectionSignature);
    }, [firstPrograms, selectionSignature, selectionSource]);

    useEffect(() => {
        setSelectedSupplementalChannelIds(new Set());
    }, [annictId]);

    useEffect(() => {
        const availableIds = new Set(supplementalChannels.map(channel => channel.id));
        setSelectedSupplementalChannelIds(current => {
            const next = new Set([...current].filter(channelId => availableIds.has(channelId)));
            if (next.size === current.size && [...next].every(channelId => current.has(channelId))) return current;
            return next;
        });
    }, [supplementalChannels]);

    useLayoutEffect(() => {
        window.scrollTo({ top: 0, behavior: 'auto' });
        const frame = window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
        return () => window.cancelAnimationFrame(frame);
    }, [annictId]);

    const selectedPrograms = useMemo(() => firstPrograms.filter(program => selectedStationKeys.has(stationKey(program))), [firstPrograms, selectedStationKeys]);
    const selectedChannelIds = useMemo(
        () => Array.from(new Set([...selectedPrograms.flatMap(program => program.localChannels.map(channel => channel.id)), ...selectedSupplementalChannelIds])),
        [selectedPrograms, selectedSupplementalChannelIds],
    );
    const selectedWeek = useMemo(
        () => (selectedSupplementalChannelIds.size > 0 ? 0x7f : selectedPrograms.reduce((value, program) => value | (1 << new Date(program.startedAt).getDay()), 0)),
        [selectedPrograms, selectedSupplementalChannelIds.size],
    );
    const titleOnlyFallback = firstPrograms.length === 0 && selectedSupplementalChannelIds.size === 0;
    const canOpenSearch = selectedChannelIds.length > 0 || titleOnlyFallback;
    const searchOption = useMemo<RuleSearchOption>(
        () => ({
            keyword: work.data?.title ?? '',
            name: true,
            description: false,
            extended: false,
            channelIds: selectedChannelIds,
            times: [{ week: selectedWeek === 0 ? 0x7f : selectedWeek }],
            searchPeriods: work.data === undefined ? undefined : firstBroadcastSearchPeriods(work.data),
        }),
        [selectedChannelIds, selectedWeek, work.data],
    );

    const openSearch = (): void => {
        if (work.data === undefined) return;
        const params = new URLSearchParams({
            keyword: work.data.title,
            week: String(selectedWeek === 0 ? 0x7f : selectedWeek),
            origin: 'anime',
            annictId: String(annictId),
            genre: '7',
            auto: '1',
        });
        const firstBroadcastDate = localDateFromIso(work.data.firstProgramStartedAt);
        if (firstBroadcastDate !== undefined) params.set('startDate', firstBroadcastDate);
        selectedChannelIds.forEach(channelId => params.append('channelId', String(channelId)));
        void navigate(`/search?${params.toString()}`);
    };

    const toggleStation = (key: string): void => {
        setSelectedStationKeys(current => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const toggleSupplementalChannel = (channelId: number): void => {
        setSelectedSupplementalChannelIds(current => {
            const next = new Set(current);
            if (next.has(channelId)) next.delete(channelId);
            else next.add(channelId);
            return next;
        });
    };

    return (
        <>
            <PageHeader
                title={work.data?.title ?? 'アニメ詳細'}
                leading={
                    <IconButton onClick={goBack}>
                        <ArrowBackOutlined />
                    </IconButton>
                }
                actions={
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Button
                            color="inherit"
                            startIcon={<OpenInNewOutlined />}
                            component="a"
                            href={`https://annict.com/works/${annictId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ whiteSpace: 'nowrap' }}
                        >
                            Annictで開く
                        </Button>
                        <IconButton
                            aria-label="更新"
                            onClick={() => void queryClient.fetchQuery({ queryKey: ['annict', 'work', annictId], queryFn: () => api.getAnnictWork(annictId, true) })}
                        >
                            <RefreshOutlined />
                        </IconButton>
                    </Stack>
                }
            />
            {work.isPending ? (
                <Loading />
            ) : work.error !== null ? (
                <Alert severity="error" sx={{ m: 2 }}>
                    {queryErrorMessage(work.error)}
                </Alert>
            ) : (
                work.data && (
                    <Stack spacing={2} sx={{ width: 'min(1000px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                        {work.data.stale && <Alert severity="warning">保存済みデータを表示しています。</Alert>}
                        {work.data.programsError && <Alert severity="warning">{work.data.programsError}</Alert>}
                        <Card variant="outlined">
                            <CardContent>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                    <Box sx={{ width: { xs: '100%', sm: 260 }, flexShrink: 0, borderRadius: 1, overflow: 'hidden' }}>
                                        <AnimeWorkImage imageUrl={listImageUrl ?? work.data.imageUrl} title={work.data.title} fallbackAnnictId={annictId} />
                                    </Box>
                                    <Box>
                                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                                            {work.data.title}
                                        </Typography>
                                        {work.data.titleKana && <Typography color="text.secondary">{work.data.titleKana}</Typography>}
                                        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                                            {work.data.media && <Chip label={work.data.media} />}
                                            {work.data.seasonName && <Chip variant="outlined" label={work.data.seasonName} />}
                                        </Stack>
                                    </Box>
                                </Stack>
                            </CardContent>
                        </Card>
                        <Box>
                            <Tabs value={detailTab} onChange={(_event, value: number) => setDetailTab(value)} aria-label="作品情報">
                                <Tab label="情報" />
                                <Tab label="キャスト" />
                                <Tab label="スタッフ" />
                            </Tabs>
                            <Divider />
                            {detailTab === 0 && <WorkInformation work={work.data} />}
                            {detailTab === 1 && <WorkCasts work={work.data} />}
                            {detailTab === 2 && <WorkStaffs work={work.data} />}
                        </Box>
                        <Box>
                            <Typography variant="h6">受信可能局の放送予定</Typography>
                            <Typography variant="body2" color="text.secondary">
                                Annictの開始日時と、EPGStationで受信できる放送局名を照合しています。実際の予約時間は検索結果のEPG情報を使用します。
                            </Typography>
                        </Box>
                        {firstPrograms.length === 0 && selectedSupplementalChannelIds.size === 0 ? (
                            <Alert severity="info">現在取得できる受信可能局の放送予定がないため、作品タイトルを全局・全曜日で検索できます。</Alert>
                        ) : firstPrograms.length > 0 ? (
                            <Stack spacing={1}>
                                <Typography variant="body2" color="text.secondary">
                                    検索・ルール作成の対象にする局を選択してください。各局の最初の放送予定を表示しています。
                                </Typography>
                                {firstPrograms.map(program => {
                                    const key = stationKey(program);
                                    return <ProgramCard key={key} program={program} selected={selectedStationKeys.has(key)} onToggle={() => toggleStation(key)} />;
                                })}
                                {additionalPrograms.length > 0 && (
                                    <Button onClick={() => setShowAllPrograms(value => !value)}>
                                        {showAllPrograms ? '以降の放送予定を閉じる' : `以降の放送予定をすべて表示（${additionalPrograms.length}件）`}
                                    </Button>
                                )}
                                {showAllPrograms && additionalPrograms.map(program => <ProgramCard key={program.annictId} program={program} />)}
                            </Stack>
                        ) : null}
                        {supplementalChannels.length > 0 && (
                            <Stack spacing={0.5}>
                                <Typography variant="body2" color="text.secondary">
                                    Annictの放送予定にない補完放送局を、必要な作品だけ検索・ルール作成の対象へ追加できます。
                                </Typography>
                                {supplementalChannels.map(channel => (
                                    <FormControlLabel
                                        key={channel.id}
                                        control={<Checkbox checked={selectedSupplementalChannelIds.has(channel.id)} onChange={() => toggleSupplementalChannel(channel.id)} />}
                                        label={`${channel.name}を検索対象へ追加（全曜日）`}
                                    />
                                ))}
                            </Stack>
                        )}
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <Button variant="contained" startIcon={<SearchOutlined />} disabled={!canOpenSearch} onClick={openSearch}>
                                {titleOnlyFallback ? '全局・全曜日で検索・予約候補' : '検索・予約候補'}
                            </Button>
                            <Button variant="outlined" startIcon={<CalendarMonthOutlined />} disabled={selectedChannelIds.length === 0} onClick={() => setRuleOpen(true)}>
                                選択した局・曜日でルール作成
                            </Button>
                        </Stack>
                        <RuleEditorDialog
                            open={ruleOpen}
                            searchOption={searchOption}
                            priorityChannelIds={selectedChannelIds}
                            annictId={annictId}
                            onClose={() => setRuleOpen(false)}
                            onSaved={() => {
                                const returnParams = new URLSearchParams({ focus: String(annictId) });
                                if (mode === 'rerun') returnParams.set('mode', 'rerun');
                                if (returnYear !== undefined) returnParams.set('year', String(returnYear));
                                if (isSeasonName(returnSeason)) returnParams.set('season', returnSeason);
                                const returnPath = `/anime?${returnParams.toString()}`;
                                void api
                                    .getReserveCounts()
                                    .then(counts => {
                                        if (counts.conflicts > 0) navigate('/reserves?type=conflict');
                                        else navigate(returnPath);
                                    })
                                    .catch(() => navigate(returnPath));
                            }}
                        />
                    </Stack>
                )
            )}
        </>
    );
}
