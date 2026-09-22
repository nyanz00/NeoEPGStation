import {
    Autocomplete,
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControlLabel,
    IconButton,
    MenuItem,
    Stack,
    Switch,
    Tab,
    Tabs,
    TextField,
    Typography,
} from '@mui/material';
import AddOutlined from '@mui/icons-material/AddOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddRuleOption, ChannelId, ChannelItem, ReserveEncodedOption, ReserveSaveOption, Rule, RuleSearchOption } from '../../../api';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import { secondsToTime, timeRuleRangeSeconds } from '../core/search/timeRule';
import { useActiveUser, type ActiveUserId } from '../core/storage/activeUser';
import { useSettings } from '../core/storage/settings';
import { useAppLayout } from './AppLayout';
import { dialogSurfacePaper, programDialogClose } from './programDialogStyles';
import { UserSelector } from './UserSelector';

interface EncodeSetting {
    mode: string;
    channelIds: ChannelId[];
    parentDirectoryName: string;
    directory: string;
}

interface RuleEditorState {
    isTimeSpecification: boolean;
    timeName: string;
    timeChannelId: ChannelId | '';
    timeStart: string;
    timeEnd: string;
    timeWeek: number;
    userId: ActiveUserId;
    enable: boolean;
    allowEndLack: boolean;
    avoidDuplicate: boolean;
    periodToAvoidDuplicate: string;
    parentDirectoryName: string;
    directory: string;
    recordedFormat: string;
    encodes: [EncodeSetting, EncodeSetting, EncodeSetting];
    deleteOriginal: boolean;
    updateThumbnail: boolean;
    encodeStartDelayMinutes: string;
    copyKeywordToDirectory: boolean;
}

export interface BulkRuleTarget {
    annictId: number;
    title: string;
    searchOption: RuleSearchOption;
}

export interface BulkRuleSaveResult {
    requested: number;
    createdAnnictIds: number[];
    alreadyAddedAnnictIds: number[];
    failed: Array<{ annictId: number; title: string }>;
    linkWarnings: Array<{ annictId: number; title: string; message: string }>;
}

interface RuleEditorDialogProps {
    open: boolean;
    searchOption: RuleSearchOption;
    priorityChannelIds?: ChannelId[];
    annictId?: number;
    rule?: Rule;
    bulkTargets?: BulkRuleTarget[];
    onClose: () => void;
    onSaved?: () => void;
    onBulkSaved?: (result: BulkRuleSaveResult) => void;
}

function emptyEncode(): EncodeSetting {
    return { mode: '', channelIds: [], parentDirectoryName: '', directory: '' };
}

function encodeFromRule(rule: Rule | undefined, index: 1 | 2 | 3): EncodeSetting {
    const option = rule?.encodeOption;
    if (option === undefined) return emptyEncode();
    const mode = option[`mode${index}`] ?? '';
    const channelIds = option[`channelIds${index}`] ?? (option[`channelId${index}`] === undefined ? [] : [option[`channelId${index}`]!]);
    return {
        mode,
        channelIds,
        parentDirectoryName: option[`encodeParentDirectoryName${index}`] ?? '',
        directory: option[`directory${index}`] ?? '',
    };
}

function initialState(rule: Rule | undefined, activeUser: ActiveUserId, settings: ReturnType<typeof useSettings>): RuleEditorState {
    const firstEncode = encodeFromRule(rule, 1);
    if (rule === undefined && settings.isEnableEncodingSettingWhenCreateRule) firstEncode.mode = '';
    return {
        isTimeSpecification: rule?.isTimeSpecification ?? false,
        timeName: rule?.isTimeSpecification ? (rule.searchOption.keyword ?? '') : '',
        timeChannelId: rule?.isTimeSpecification ? (rule.searchOption.channelIds?.[0] ?? '') : '',
        timeStart: rule?.isTimeSpecification ? secondsToTime(rule.searchOption.times?.[0]?.start ?? 0) : '00:00',
        timeEnd: rule?.isTimeSpecification ? secondsToTime((rule.searchOption.times?.[0]?.start ?? 0) + (rule.searchOption.times?.[0]?.range ?? 0)) : '00:30',
        timeWeek: rule?.isTimeSpecification ? (rule.searchOption.times?.[0]?.week ?? 0x7f) : 0x7f,
        userId: rule?.userId ?? (typeof activeUser === 'number' ? activeUser : null),
        enable: rule?.reserveOption.enable ?? true,
        allowEndLack: rule?.reserveOption.allowEndLack ?? true,
        avoidDuplicate: rule?.reserveOption.avoidDuplicate ?? settings.isCheckAvoidDuplicate,
        periodToAvoidDuplicate: rule?.reserveOption.periodToAvoidDuplicate?.toString(10) ?? '',
        parentDirectoryName: rule?.saveOption?.parentDirectoryName ?? '',
        directory: rule?.saveOption?.directory ?? '',
        recordedFormat: rule?.saveOption?.recordedFormat ?? '',
        encodes: [firstEncode, encodeFromRule(rule, 2), encodeFromRule(rule, 3)],
        deleteOriginal: rule?.encodeOption?.isDeleteOriginalAfterEncode ?? settings.isCheckDeleteOriginalAfterEncode,
        updateThumbnail: rule?.encodeOption?.updateThumbnail === true,
        encodeStartDelayMinutes: rule?.encodeOption?.startDelayMinutes?.toString(10) ?? '0',
        copyKeywordToDirectory: rule === undefined && settings.isEnableCopyKeywordToDirectory,
    };
}

function buildSaveOption(state: RuleEditorState): ReserveSaveOption | undefined {
    const option: ReserveSaveOption = {};
    if (state.parentDirectoryName.length > 0) option.parentDirectoryName = state.parentDirectoryName;
    if (state.directory.trim().length > 0) option.directory = state.directory.trim();
    if (state.recordedFormat.trim().length > 0) option.recordedFormat = state.recordedFormat.trim();
    return Object.keys(option).length === 0 ? undefined : option;
}

function buildEncodeOption(state: RuleEditorState): ReserveEncodedOption | undefined {
    if (state.encodes.every(item => item.mode.length === 0)) return undefined;
    const option: ReserveEncodedOption = {
        isDeleteOriginalAfterEncode: state.deleteOriginal,
        updateThumbnail: state.updateThumbnail,
        startDelayMinutes: Number(state.encodeStartDelayMinutes),
    };
    state.encodes.forEach((item, offset) => {
        if (item.mode.length === 0) return;
        const index = (offset + 1) as 1 | 2 | 3;
        option[`mode${index}`] = item.mode;
        if (item.channelIds.length > 0) {
            option[`channelIds${index}`] = item.channelIds;
            if (item.channelIds.length === 1) option[`channelId${index}`] = item.channelIds[0];
        }
        if (item.parentDirectoryName.length > 0) option[`encodeParentDirectoryName${index}`] = item.parentDirectoryName;
        if (item.directory.trim().length > 0) option[`directory${index}`] = item.directory.trim();
    });
    return option;
}

function applyBulkDirectoryDefaults(
    saveOption: ReserveSaveOption | undefined,
    encodeOption: ReserveEncodedOption | undefined,
    title: string,
    copyKeywordToDirectory: boolean,
): { saveOption?: ReserveSaveOption; encodeOption?: ReserveEncodedOption } {
    const nextSaveOption = saveOption === undefined ? undefined : { ...saveOption };
    const nextEncodeOption = encodeOption === undefined ? undefined : { ...encodeOption };
    if (!copyKeywordToDirectory) return { saveOption: nextSaveOption, encodeOption: nextEncodeOption };

    const resolvedSaveOption = nextSaveOption ?? {};
    if (resolvedSaveOption.directory === undefined) resolvedSaveOption.directory = title;
    if (nextEncodeOption !== undefined) {
        ([1, 2, 3] as const).forEach(index => {
            if (nextEncodeOption[`mode${index}`] !== undefined && nextEncodeOption[`directory${index}`] === undefined) {
                nextEncodeOption[`directory${index}`] = title;
            }
        });
    }
    return { saveOption: resolvedSaveOption, encodeOption: nextEncodeOption };
}

function EncodeRow({
    index,
    value,
    channels,
    modes,
    directories,
    onChange,
    onDelete,
}: {
    index: number;
    value: EncodeSetting;
    channels: ChannelItem[];
    modes: string[];
    directories: string[];
    onChange: (value: EncodeSetting) => void;
    onDelete: () => void;
}): ReactNode {
    const selectedChannels = channels.filter(channel => value.channelIds.includes(channel.id));
    return (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '7px', overflow: 'hidden' }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 0.75, bgcolor: 'action.hover' }}>
                <Typography sx={{ fontWeight: 700 }}>エンコード{index}</Typography>
                <IconButton size="small" aria-label={`エンコード${index}を削除`} onClick={onDelete}>
                    <DeleteOutlineOutlined fontSize="small" />
                </IconButton>
            </Stack>
            <Stack spacing={1.5} sx={{ p: 1.5 }}>
                <TextField select size="small" label="エンコードプリセット" value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value })}>
                    <MenuItem value="">なし</MenuItem>
                    {modes.map(mode => (
                        <MenuItem key={mode} value={mode}>
                            {mode}
                        </MenuItem>
                    ))}
                </TextField>
                <Autocomplete
                    multiple
                    disableCloseOnSelect
                    options={channels}
                    value={selectedChannels}
                    getOptionLabel={channel => channel.name}
                    isOptionEqualToValue={(a, b) => a.id === b.id}
                    onChange={(_event, selected) => onChange({ ...value, channelIds: selected.map(channel => channel.id) })}
                    renderOption={(props, channel, state) => {
                        const { key, ...optionProps } = props;
                        return (
                            <li key={key} {...optionProps}>
                                <Checkbox checked={state.selected} sx={{ mr: 1 }} />
                                {channel.name}
                            </li>
                        );
                    }}
                    renderInput={params => <TextField {...params} size="small" label="対象局（未指定なら全局）" />}
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <TextField
                        select
                        fullWidth
                        size="small"
                        label="保存先"
                        value={value.parentDirectoryName}
                        onChange={event => onChange({ ...value, parentDirectoryName: event.target.value })}
                    >
                        <MenuItem value="">既定</MenuItem>
                        {directories.map(directory => (
                            <MenuItem key={directory} value={directory}>
                                {directory}
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField fullWidth size="small" label="サブディレクトリ" value={value.directory} onChange={event => onChange({ ...value, directory: event.target.value })} />
                </Stack>
            </Stack>
        </Box>
    );
}

function getInitialEncodeRowCount(state: RuleEditorState): number {
    let count = 0;
    state.encodes.forEach((encode, index) => {
        if (encode.mode.length > 0 || encode.channelIds.length > 0 || encode.parentDirectoryName.length > 0 || encode.directory.length > 0) count = index + 1;
    });
    return Math.max(1, count);
}

export function RuleEditorDialog({ open, searchOption, priorityChannelIds = [], annictId, rule, bulkTargets, onClose, onSaved, onBulkSaved }: RuleEditorDialogProps): ReactNode {
    const { contentOffset } = useAppLayout();
    const activeUser = useActiveUser();
    const settings = useSettings();
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const [state, setState] = useState<RuleEditorState>(() => initialState(rule, activeUser, settings));
    const [activeTab, setActiveTab] = useState(0);
    const [encodeRowCount, setEncodeRowCount] = useState(() => getInitialEncodeRowCount(initialState(rule, activeUser, settings)));
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const bulkMode = bulkTargets !== undefined;
    const sortedChannels = [...(channels.data ?? [])].sort((a, b) => {
        const aIndex = priorityChannelIds.indexOf(a.id);
        const bIndex = priorityChannelIds.indexOf(b.id);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });

    useEffect(() => {
        if (!open) return;
        const next = initialState(rule, activeUser, settings);
        if (rule === undefined && settings.isEnableEncodingSettingWhenCreateRule && (config.data?.encode.length ?? 0) > 0) {
            next.encodes[0].mode = config.data!.encode[0];
        }
        if (!bulkMode && rule === undefined && settings.isEnableCopyKeywordToDirectory && searchOption.keyword !== undefined) {
            next.directory = searchOption.keyword;
            next.encodes[0].directory = searchOption.keyword;
        }
        setState(next);
        setActiveTab(0);
        setEncodeRowCount(getInitialEncodeRowCount(next));
    }, [activeUser, bulkMode, config.data, open, rule, searchOption.keyword, settings]);

    const save = useMutation({
        mutationFn: async () => {
            if (typeof state.userId !== 'number') throw new Error('ルールを作成するユーザーを選択してください');
            const period = state.periodToAvoidDuplicate.length === 0 ? undefined : Number(state.periodToAvoidDuplicate);
            if (period !== undefined && (!Number.isFinite(period) || period < 0)) throw new Error('重複回避日数を正しく入力してください');
            const encodeStartDelayMinutes = Number(state.encodeStartDelayMinutes);
            if (state.encodes.some(encode => encode.mode.length > 0) && (Number.isSafeInteger(encodeStartDelayMinutes) === false || encodeStartDelayMinutes < 0)) {
                throw new Error('エンコード開始待機時間を0以上の整数で入力してください');
            }
            let effectiveSearchOption = searchOption;
            if (!bulkMode && state.isTimeSpecification) {
                if (state.timeName.trim().length === 0) throw new Error('番組名を入力してください');
                if (state.timeChannelId === '') throw new Error('放送局を選択してください');
                if (state.timeWeek === 0) throw new Error('曜日を1つ以上選択してください');
                const { start, range } = timeRuleRangeSeconds(state.timeStart, state.timeEnd);
                effectiveSearchOption = {
                    keyword: state.timeName.trim(),
                    channelIds: [state.timeChannelId],
                    times: [{ start, range, week: state.timeWeek }],
                };
            }
            const reserveOption = {
                enable: state.enable,
                allowEndLack: state.allowEndLack,
                avoidDuplicate: state.avoidDuplicate,
                periodToAvoidDuplicate: period,
            };
            const commonSaveOption = buildSaveOption(state);
            const commonEncodeOption = buildEncodeOption(state);

            if (bulkTargets !== undefined) {
                if (bulkTargets.length === 0) throw new Error('追加する作品がありません');
                const pageSize = 1000;
                const firstPage = await api.getRules({ type: 'normal', userId: state.userId, offset: 0, limit: pageSize });
                const existingRules = [...firstPage.rules];
                for (let offset = pageSize; offset < firstPage.total; offset += pageSize) {
                    const page = await api.getRules({ type: 'normal', userId: state.userId, offset, limit: pageSize });
                    existingRules.push(...page.rules);
                }
                const existingAnnictIds = new Set(existingRules.flatMap(item => (item.annictId === undefined ? [] : [item.annictId])));
                const result: BulkRuleSaveResult = {
                    requested: bulkTargets.length,
                    createdAnnictIds: [],
                    alreadyAddedAnnictIds: [],
                    failed: [],
                    linkWarnings: [],
                };
                for (const target of bulkTargets) {
                    if (existingAnnictIds.has(target.annictId)) {
                        result.alreadyAddedAnnictIds.push(target.annictId);
                        continue;
                    }
                    const resolved = applyBulkDirectoryDefaults(commonSaveOption, commonEncodeOption, target.title, state.copyKeywordToDirectory);
                    const option: AddRuleOption = {
                        isTimeSpecification: false,
                        userId: state.userId,
                        searchOption: target.searchOption,
                        reserveOption,
                        saveOption: resolved.saveOption,
                        encodeOption: resolved.encodeOption,
                    };
                    try {
                        const ruleId = await api.addRule(option);
                        result.createdAnnictIds.push(target.annictId);
                        try {
                            const linkResult = await api.linkAnnictRule(ruleId, target.annictId);
                            if (linkResult.statusUpdateError !== undefined) {
                                result.linkWarnings.push({
                                    annictId: target.annictId,
                                    title: target.title,
                                    message: linkResult.statusUpdateError,
                                });
                            }
                        } catch (error) {
                            result.linkWarnings.push({
                                annictId: target.annictId,
                                title: target.title,
                                message: error instanceof Error ? error.message : 'Annictの視聴ステータスを更新できませんでした',
                            });
                        }
                    } catch {
                        result.failed.push({ annictId: target.annictId, title: target.title });
                    }
                }
                return { kind: 'bulk' as const, result };
            }

            const option: AddRuleOption = {
                isTimeSpecification: state.isTimeSpecification,
                userId: state.userId,
                searchOption: effectiveSearchOption,
                reserveOption,
                saveOption: commonSaveOption,
                encodeOption: commonEncodeOption,
            };
            if (rule !== undefined) {
                await api.updateRule(rule.id, option, settings.annictStopWatchingOnRuleDisable);
                return { kind: 'single' as const, annictStatusError: undefined, annictLinkError: undefined };
            }
            const ruleId = await api.addRule(option);
            if (annictId === undefined) return { kind: 'single' as const, annictStatusError: undefined, annictLinkError: undefined };
            try {
                const linkResult = await api.linkAnnictRule(ruleId, annictId);
                return { kind: 'single' as const, annictStatusError: linkResult.statusUpdateError, annictLinkError: undefined };
            } catch (error) {
                return {
                    kind: 'single' as const,
                    annictStatusError: undefined,
                    annictLinkError: error instanceof Error ? error.message : 'Annict作品との関連付けに失敗しました',
                };
            }
        },
        onSuccess: async result => {
            await Promise.allSettled([
                queryClient.invalidateQueries({ queryKey: ['rules'] }),
                queryClient.invalidateQueries({ queryKey: ['reserves'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-counts'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
                queryClient.invalidateQueries({ queryKey: ['annict', 'viewer-statuses'] }),
            ]);
            if (result.kind === 'bulk') {
                onBulkSaved?.(result.result);
                onClose();
                return;
            }
            notify(rule === undefined ? 'ルールを追加しました' : 'ルールを更新しました', 'success');
            if (result.annictStatusError !== undefined) {
                notify(`ルールは関連付けましたが、Annict視聴ステータスを更新できませんでした: ${result.annictStatusError}`, 'warning');
            }
            if (result.annictLinkError !== undefined) notify(`ルールは追加しましたが、Annict作品との関連付けに失敗しました: ${result.annictLinkError}`, 'warning');
            onSaved?.();
            onClose();
        },
        onError: error => notify(`ルールの保存に失敗しました: ${error.message}`, 'error'),
    });

    const patchEncode = (index: number, value: EncodeSetting): void =>
        setState(current => {
            const encodes = [...current.encodes] as RuleEditorState['encodes'];
            encodes[index] = value;
            return { ...current, encodes };
        });

    const deleteEncode = (index: number): void => {
        setState(current => {
            const encodes = current.encodes.filter((_encode, encodeIndex) => encodeIndex !== index);
            encodes.push(emptyEncode());
            return { ...current, encodes: encodes as RuleEditorState['encodes'] };
        });
        setEncodeRowCount(current => Math.max(0, current - 1));
    };

    return (
        <Dialog
            open={open}
            onClose={save.isPending ? undefined : onClose}
            fullWidth
            maxWidth={false}
            slotProps={{
                container: {
                    sx: {
                        alignItems: { lg: 'flex-start' },
                        boxSizing: 'border-box',
                        pt: { lg: 10 },
                        pl: { lg: `${contentOffset.toString(10)}px` },
                    },
                },
                paper: {
                    sx: theme => ({
                        ...dialogSurfacePaper(theme),
                        width: { xs: 'calc(100% - 24px)', sm: 'min(860px, calc(100% - 64px))' },
                        m: { xs: 1.5, sm: 0 },
                        maxHeight: { xs: 'calc(100dvh - 24px)', sm: 'calc(100dvh - 64px)', lg: 'calc(100dvh - 96px)' },
                        '& .MuiDialogActions-root': {
                            borderTop: 1,
                            borderColor: 'divider',
                            gap: 1,
                            '& .MuiButton-root': { minHeight: 42, borderRadius: '7px' },
                        },
                    }),
                },
            }}
        >
            <DialogTitle sx={{ position: 'relative', pr: 7 }}>
                {bulkMode ? `ルール一括追加（${bulkTargets.length.toString(10)}作品）` : rule === undefined ? 'ルール追加' : 'ルール編集'}
                <IconButton aria-label="閉じる" disabled={save.isPending} onClick={onClose} sx={programDialogClose}>
                    <CloseOutlined />
                </IconButton>
            </DialogTitle>
            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { sm: 'center' }, px: { xs: 2, sm: 3 }, py: 1.5, bgcolor: 'action.hover', borderTop: 1, borderColor: 'divider' }}
            >
                <UserSelector value={state.userId} onChange={value => setState(current => ({ ...current, userId: value }))} includeMaster={false} />
                <FormControlLabel
                    control={<Checkbox checked={state.enable} onChange={event => setState(current => ({ ...current, enable: event.target.checked }))} />}
                    label="有効"
                />
            </Stack>
            <Tabs value={activeTab} onChange={(_event, value: number) => setActiveTab(value)} variant="fullWidth" aria-label="ルール設定項目">
                <Tab label="録画・保存" />
                <Tab label={`エンコード ${encodeRowCount.toString(10)}`} />
            </Tabs>
            <DialogContent dividers sx={{ py: 2 }}>
                {activeTab === 0 && (
                    <Stack spacing={2}>
                        {!bulkMode && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={state.isTimeSpecification}
                                        disabled={rule !== undefined}
                                        onChange={event => setState(current => ({ ...current, isTimeSpecification: event.target.checked }))}
                                    />
                                }
                                label="時刻指定"
                            />
                        )}
                        {!bulkMode && state.isTimeSpecification && (
                            <Stack spacing={1.5}>
                                <TextField
                                    size="small"
                                    label="番組名"
                                    value={state.timeName}
                                    onChange={event => setState(current => ({ ...current, timeName: event.target.value }))}
                                />
                                <TextField
                                    select
                                    size="small"
                                    label="放送局"
                                    value={state.timeChannelId}
                                    onChange={event => setState(current => ({ ...current, timeChannelId: Number(event.target.value) }))}
                                >
                                    {sortedChannels.map(channel => (
                                        <MenuItem key={channel.id} value={channel.id}>
                                            {channel.name}
                                        </MenuItem>
                                    ))}
                                </TextField>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        type="time"
                                        label="開始時刻"
                                        value={state.timeStart}
                                        onChange={event => setState(current => ({ ...current, timeStart: event.target.value }))}
                                        slotProps={{ inputLabel: { shrink: true } }}
                                    />
                                    <TextField
                                        fullWidth
                                        size="small"
                                        type="time"
                                        label="終了時刻"
                                        value={state.timeEnd}
                                        onChange={event => setState(current => ({ ...current, timeEnd: event.target.value }))}
                                        slotProps={{ inputLabel: { shrink: true } }}
                                    />
                                </Stack>
                                <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
                                    {['日', '月', '火', '水', '木', '金', '土'].map((label, index) => {
                                        const bit = 1 << index;
                                        return (
                                            <FormControlLabel
                                                key={label}
                                                control={
                                                    <Checkbox
                                                        checked={(state.timeWeek & bit) !== 0}
                                                        onChange={event =>
                                                            setState(current => ({
                                                                ...current,
                                                                timeWeek: event.target.checked ? current.timeWeek | bit : current.timeWeek & ~bit,
                                                            }))
                                                        }
                                                    />
                                                }
                                                label={label}
                                            />
                                        );
                                    })}
                                </Stack>
                            </Stack>
                        )}
                        <FormControlLabel
                            control={<Checkbox checked={state.allowEndLack} onChange={event => setState(current => ({ ...current, allowEndLack: event.target.checked }))} />}
                            label="状況に応じて末尾切れを許可"
                        />
                        <Divider />
                        <Box>
                            <Typography sx={{ mb: 1, fontWeight: 700 }}>重複回避</Typography>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
                                <FormControlLabel
                                    control={
                                        <Checkbox checked={state.avoidDuplicate} onChange={event => setState(current => ({ ...current, avoidDuplicate: event.target.checked }))} />
                                    }
                                    label="録画済み番組を除外"
                                />
                                <TextField
                                    size="small"
                                    type="number"
                                    label="対象日数"
                                    value={state.periodToAvoidDuplicate}
                                    onChange={event => setState(current => ({ ...current, periodToAvoidDuplicate: event.target.value }))}
                                    sx={{ width: 140 }}
                                />
                            </Stack>
                        </Box>
                        <Divider />
                        <Box>
                            <Typography sx={{ mb: 1, fontWeight: 700 }}>録画ファイル</Typography>
                            <Stack spacing={1.5}>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                                    <TextField
                                        select
                                        fullWidth
                                        size="small"
                                        label="保存先"
                                        value={state.parentDirectoryName}
                                        onChange={event => setState(current => ({ ...current, parentDirectoryName: event.target.value }))}
                                    >
                                        <MenuItem value="">既定</MenuItem>
                                        {config.data?.recorded.map(directory => (
                                            <MenuItem key={directory} value={directory}>
                                                {directory}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        label="サブディレクトリ"
                                        value={state.directory}
                                        onChange={event => setState(current => ({ ...current, directory: event.target.value }))}
                                    />
                                </Stack>
                                <TextField
                                    size="small"
                                    label="ファイル名形式"
                                    value={state.recordedFormat}
                                    onChange={event => setState(current => ({ ...current, recordedFormat: event.target.value }))}
                                />
                                {bulkMode && (
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={state.copyKeywordToDirectory}
                                                onChange={event => setState(current => ({ ...current, copyKeywordToDirectory: event.target.checked }))}
                                            />
                                        }
                                        label="空のサブディレクトリには作品名を個別に使用"
                                    />
                                )}
                            </Stack>
                        </Box>
                    </Stack>
                )}
                {activeTab === 1 && (
                    <Stack spacing={2}>
                        {state.encodes.slice(0, encodeRowCount).map((encode, index) => (
                            <EncodeRow
                                key={index}
                                index={index + 1}
                                value={encode}
                                channels={sortedChannels}
                                modes={config.data?.encode ?? []}
                                directories={config.data?.recorded ?? []}
                                onChange={value => patchEncode(index, value)}
                                onDelete={() => deleteEncode(index)}
                            />
                        ))}
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                            <Button
                                variant="outlined"
                                color="inherit"
                                startIcon={<AddOutlined />}
                                disabled={encodeRowCount >= 3}
                                onClick={() => setEncodeRowCount(current => Math.min(3, current + 1))}
                            >
                                エンコードを追加
                            </Button>
                            <Typography variant="caption" color="text.secondary">
                                最大3件
                            </Typography>
                        </Stack>
                        <Divider />
                        <Box>
                            <Typography sx={{ mb: 1, fontWeight: 700 }}>共通設定</Typography>
                            <Stack spacing={1.5}>
                                <Stack direction={{ xs: 'column', sm: 'row' }}>
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={state.deleteOriginal}
                                                onChange={event => setState(current => ({ ...current, deleteOriginal: event.target.checked }))}
                                            />
                                        }
                                        label="エンコード後に元ファイルを削除"
                                    />
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                checked={state.updateThumbnail}
                                                onChange={event => setState(current => ({ ...current, updateThumbnail: event.target.checked }))}
                                            />
                                        }
                                        label="サムネイル再生成"
                                    />
                                </Stack>
                                <TextField
                                    size="small"
                                    type="number"
                                    label="エンコード開始待機時間（分）"
                                    disabled={state.encodes.every(encode => encode.mode.length === 0)}
                                    value={state.encodeStartDelayMinutes}
                                    onChange={event => setState(current => ({ ...current, encodeStartDelayMinutes: event.target.value }))}
                                    sx={{ width: { xs: '100%', sm: 260 } }}
                                    slotProps={{
                                        htmlInput: { min: 0, step: 1 },
                                    }}
                                    helperText="録画完了後、通常のエンコードキューへ投入するまで待機"
                                />
                            </Stack>
                        </Box>
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button color="inherit" variant="outlined" disabled={save.isPending} onClick={onClose}>
                    キャンセル
                </Button>
                <Button variant="contained" disabled={save.isPending || typeof state.userId !== 'number'} onClick={() => save.mutate()}>
                    {save.isPending ? (bulkMode ? '追加中…' : '保存中…') : bulkMode ? '一括追加' : rule === undefined ? '追加' : '更新'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
