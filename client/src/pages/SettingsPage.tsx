import AddOutlined from '@mui/icons-material/AddOutlined';
import ChatBubbleOutlineOutlined from '@mui/icons-material/ChatBubbleOutlineOutlined';
import ContentPasteOutlined from '@mui/icons-material/ContentPasteOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import PlayCircleOutlineOutlined from '@mui/icons-material/PlayCircleOutlineOutlined';
import RuleOutlined from '@mui/icons-material/RuleOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Slider,
    Stack,
    Switch,
    Tab,
    Tabs,
    TextField,
    Tooltip,
    Typography,
    useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { MisskeyAuthorizationStart, MisskeyVisibility } from '../../../api';
import { PageHeader } from '../components/PageHeader';
import { ChannelSelector } from '../components/ChannelSelector';
import { ThemedColorPicker } from '../components/ThemedColorPicker';
import { DiscordSettingsPanel, type DiscordSettingsPanelHandle } from '../components/settings/DiscordSettingsPanel';
import { SideNavigationSettings } from '../components/settings/SideNavigationSettings';
import { ViewerProfilePasswordField } from '../components/ViewerProfilePasswordField';
import { ViewerRecoveryCodeDialog } from '../components/ViewerRecoveryCodeDialog';
import { AlphaAIcon } from '../components/icons/AlphaAIcon';
import { api } from '../core/api/queries';
import { isAppleMobileWebKit } from '../core/platform/webkit';
import { appIconAssetUrl, appIconSets, getAppIconSet, type AppIconSetId } from '../core/icons/appIcons';
import { activeUserStore, useActiveUser, type ActiveUserId } from '../core/storage/activeUser';
import { type AppSettings, type WatchStreamEncoderSetting, settingsStore, useSettings } from '../core/storage/settings';
import { appThemePresets, type AppThemePresetId } from '../core/theme/themePresets';
import { customCssPreviewStore, isCustomCssDisabledByUrl } from '../core/theme/customCss';
import { themePreviewStore } from '../core/theme/themePreview';
import { viewerProfileStore, useViewerProfile } from '../core/storage/viewerProfile';
import { normalizeViewerProfilePassword, viewerProfilePasswordError } from '../core/viewerProfilePassword';
import { useNotifications } from '../core/notifications/Notifications';

type PasteFallbackReason = 'insecure' | 'permission' | 'unavailable' | 'failed';
type SettingsTab = 'general' | 'viewing' | 'display' | 'search-rule' | 'account' | 'annict' | 'discord';

const settingsTabs: ReadonlyArray<{ value: SettingsTab; label: string; icon: ReactElement }> = [
    { value: 'general', label: '全般', icon: <TuneOutlined /> },
    { value: 'viewing', label: '視聴', icon: <PlayCircleOutlineOutlined /> },
    { value: 'display', label: '表示', icon: <VisibilityOutlined /> },
    { value: 'search-rule', label: '検索・ルール', icon: <RuleOutlined /> },
    { value: 'account', label: 'アカウント', icon: <LinkOutlined /> },
    { value: 'annict', label: 'Annict', icon: <AlphaAIcon /> },
    { value: 'discord', label: 'Discord', icon: <ChatBubbleOutlineOutlined /> },
];

function SettingRow({ title, description, control }: { title: string; description?: string; control: ReactNode }): ReactNode {
    return (
        <Box
            sx={{
                minHeight: 64,
                py: 1.25,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(180px, auto)' },
                gap: { xs: 1, sm: 3 },
                alignItems: 'center',
            }}
        >
            <Box>
                <Typography variant="body1">{title}</Typography>
                {description !== undefined && (
                    <Typography variant="body2" color="text.disabled" sx={{ mt: 0.25, fontSize: '0.8125rem', lineHeight: 1.45 }}>
                        {description}
                    </Typography>
                )}
            </Box>
            <Box sx={{ minWidth: 0, justifySelf: { sm: 'end' }, width: { xs: '100%', sm: 'auto' } }}>{control}</Box>
        </Box>
    );
}

function QueryLoadError({ label, error, onRetry }: { label: string; error: Error; onRetry: () => void }): ReactNode {
    return (
        <Alert severity="error" action={<Button onClick={onRetry}>再試行</Button>} sx={{ my: 1 }}>
            {label}を取得できません: {error.message}
        </Alert>
    );
}

function PercentSlider({
    value,
    minimum,
    maximum,
    step,
    onChange,
}: {
    value: number;
    minimum: number;
    maximum: number;
    step: number;
    onChange: (value: number) => void;
}): ReactNode {
    return (
        <Stack direction="row" spacing={2} sx={{ width: { xs: '100%', sm: 280 }, alignItems: 'center' }}>
            <Slider value={value} min={minimum} max={maximum} step={step} valueLabelDisplay="auto" onChange={(_, next) => onChange(Number(next))} />
            <Typography variant="body2" sx={{ minWidth: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {value}%
            </Typography>
        </Stack>
    );
}

function SettingSection({ title, children }: { title: string; children: ReactNode }): ReactNode {
    return (
        <Card variant="outlined">
            <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
                <Typography component="h2" variant="h6" sx={{ mb: 1 }}>
                    {title}
                </Typography>
                <Divider />
                {children}
            </CardContent>
        </Card>
    );
}

function ThemePresetSwatch({ color }: { color: string }): ReactNode {
    return (
        <Box
            sx={{
                width: 18,
                height: 18,
                flex: '0 0 auto',
                border: '1px solid',
                borderColor: 'background.paper',
                borderRadius: '50%',
                bgcolor: color,
            }}
        />
    );
}

function CustomThemeColorControl({ value, onChange }: { value: string; onChange: (value: string) => void }): ReactNode {
    const [hexInput, setHexInput] = useState(value.toUpperCase());
    const isValidHex = /^#[0-9a-f]{6}$/i.test(hexInput);

    useEffect(() => setHexInput(value.toUpperCase()), [value]);

    const updateFromHex = (next: string): void => {
        setHexInput(next);
        if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next.toLowerCase());
    };

    return (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
            <ThemedColorPicker
                value={value}
                label="カスタムテーマカラー"
                onChange={next => {
                    setHexInput(next.toUpperCase());
                    onChange(next);
                }}
                showHexInput={false}
                width={76}
                height={40}
            />
            <TextField
                size="small"
                label="HEX"
                value={hexInput}
                error={!isValidHex}
                helperText={isValidHex ? ' ' : '例: #20A89A'}
                onChange={event => updateFromHex(event.target.value)}
                onBlur={() => {
                    if (!isValidHex) setHexInput(value.toUpperCase());
                }}
                slotProps={{ htmlInput: { maxLength: 7, spellCheck: false, 'aria-label': 'カスタムテーマカラーのHEX値' } }}
                sx={{ width: 150, '& input': { fontFamily: 'monospace', textTransform: 'uppercase' } }}
            />
        </Stack>
    );
}

function SubtitlePriorityControl({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }): ReactNode {
    const update = (index: number, value: string): void => {
        const next = [...values];
        next[index] = value;
        onChange(next);
    };
    const remove = (index: number): void => onChange(values.filter((_, current) => current !== index));

    return (
        <Stack spacing={1} sx={{ width: { xs: '100%', sm: 380 } }}>
            {values.map((value, index) => (
                <Stack key={index} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <TextField fullWidth size="small" label={`優先順位 ${index + 1}`} value={value} onChange={event => update(index, event.target.value)} />
                    {index >= 3 && (
                        <Tooltip title={`優先順位 ${index + 1}を削除`}>
                            <IconButton aria-label={`優先順位 ${index + 1}を削除`} onClick={() => remove(index)}>
                                <DeleteOutlineOutlined />
                            </IconButton>
                        </Tooltip>
                    )}
                </Stack>
            ))}
            <Button variant="outlined" startIcon={<AddOutlined />} onClick={() => onChange([...values, ''])} sx={{ alignSelf: 'flex-start' }}>
                優先順位を追加
            </Button>
        </Stack>
    );
}

export function SettingsPage(): ReactNode {
    const theme = useTheme();
    const isDesktopSettingsNavigation = useMediaQuery(theme.breakpoints.up('md'));
    const savedSettings = useSettings();
    const activeUser = useActiveUser();
    const activeViewerProfile = useViewerProfile();
    const [draft, setDraft] = useState<AppSettings>(savedSettings);
    const [newUserName, setNewUserName] = useState('');
    const [renameUserName, setRenameUserName] = useState('');
    const [annictToken, setAnnictToken] = useState('');
    const [annictWriteToken, setAnnictWriteToken] = useState('');
    const [twitterCookies, setTwitterCookies] = useState('');
    const [blueskyHandle, setBlueskyHandle] = useState('');
    const [blueskyAppPassword, setBlueskyAppPassword] = useState('');
    const [misskeyVisibility, setMisskeyVisibility] = useState<MisskeyVisibility>('home');
    const [misskeyAuthorization, setMisskeyAuthorization] = useState<MisskeyAuthorizationStart | null>(null);
    const [niconicoCookies, setNiconicoCookies] = useState('');
    const [newViewerProfileUseLock, setNewViewerProfileUseLock] = useState(false);
    const [newViewerProfilePassword, setNewViewerProfilePassword] = useState('');
    const [viewerProfilePassword, setViewerProfilePassword] = useState('');
    const [unlockPassword, setUnlockPassword] = useState('');
    const [activeUserPassword, setActiveUserPassword] = useState('');
    const [pendingActiveUser, setPendingActiveUser] = useState<{ userId: number; profileId: number; name: string } | null>(null);
    const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
    const [recoveryRotateConfirmOpen, setRecoveryRotateConfirmOpen] = useState(false);
    const [deleteUserConfirmOpen, setDeleteUserConfirmOpen] = useState(false);
    const [deleteUserPassword, setDeleteUserPassword] = useState('');
    const [pasteTarget, setPasteTarget] = useState<'read' | 'write' | null>(null);
    const [pasteValue, setPasteValue] = useState('');
    const [pasteFallbackReason, setPasteFallbackReason] = useState<PasteFallbackReason>('failed');
    const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('general');
    const discordSettingsRef = useRef<DiscordSettingsPanelHandle>(null);
    const { notify } = useNotifications();
    const queryClient = useQueryClient();
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const channels = useQuery({
        queryKey: ['channels'],
        queryFn: api.getChannels,
        enabled: config.data?.developerMode === true,
    });
    const users = useQuery({ queryKey: ['users'], queryFn: api.getUsers });
    const viewerProfiles = useQuery({ queryKey: ['viewer-profiles'], queryFn: api.getViewerProfiles });
    const linkedViewerProfile = typeof activeUser === 'number' ? viewerProfiles.data?.profiles.find(profile => profile.tvUserId === activeUser) : undefined;
    const linkedViewerProfileStatus = viewerProfiles.isPending
        ? '確認中…'
        : viewerProfiles.isError
          ? '取得失敗'
          : typeof activeUser !== 'number'
            ? '通常ユーザーを選択してください'
            : linkedViewerProfile === undefined
              ? `${users.data?.users.find(user => user.id === activeUser)?.name ?? '選択中のユーザー'}: 未連携`
              : `${users.data?.users.find(user => user.id === activeUser)?.name ?? linkedViewerProfile.name}: 連携済み`;
    const activeUserInfo = typeof activeUser === 'number' ? users.data?.users.find(user => user.id === activeUser) : undefined;
    const channelOptions = useMemo(
        () =>
            (channels.data ?? []).map(channel => ({
                id: channel.id,
                label: channel.name,
                searchText: `${channel.name} ${channel.halfWidthName ?? ''}`,
            })),
        [channels.data],
    );
    const annictStatus = useQuery({
        queryKey: ['annict', 'status', activeViewerProfile.profileId, activeViewerProfile.sessionToken],
        queryFn: api.getAnnictStatus,
    });
    const twitterStatus = useQuery({
        queryKey: ['twitter', 'status', activeViewerProfile.profileId, activeViewerProfile.sessionToken],
        queryFn: api.getTwitterStatus,
    });
    const blueskyStatus = useQuery({
        queryKey: ['bluesky', 'status', activeViewerProfile.profileId, activeViewerProfile.sessionToken],
        queryFn: api.getBlueskyStatus,
    });
    const misskeyStatus = useQuery({
        queryKey: ['misskey', 'status', activeViewerProfile.profileId, activeViewerProfile.sessionToken],
        queryFn: api.getMisskeyStatus,
    });
    const niconicoStatus = useQuery({
        queryKey: ['niconico', 'status', activeViewerProfile.profileId, activeViewerProfile.sessionToken],
        queryFn: api.getNiconicoStatus,
    });
    const newViewerProfilePasswordError = viewerProfilePasswordError(newViewerProfilePassword);
    const viewerProfilePasswordValidationError = viewerProfilePasswordError(viewerProfilePassword);
    const unlockPasswordError = viewerProfilePasswordError(unlockPassword);
    const activeUserPasswordError = viewerProfilePasswordError(activeUserPassword);

    useEffect(() => setDraft(savedSettings), [savedSettings]);
    useEffect(() => {
        themePreviewStore.set({
            shouldUseOSColorTheme: draft.shouldUseOSColorTheme,
            isForceDarkTheme: draft.isForceDarkTheme,
            themeColorPreset: draft.themeColorPreset,
            customThemeColor: draft.customThemeColor,
            isEmphasizeLightThemeEdges: draft.isEmphasizeLightThemeEdges,
        });
    }, [draft.customThemeColor, draft.isEmphasizeLightThemeEdges, draft.isForceDarkTheme, draft.shouldUseOSColorTheme, draft.themeColorPreset]);
    useEffect(() => () => themePreviewStore.clear(), []);
    useEffect(() => {
        customCssPreviewStore.set({ enabled: draft.isCustomCssEnabled, css: draft.customCss });
    }, [draft.customCss, draft.isCustomCssEnabled]);
    useEffect(() => () => customCssPreviewStore.clear(), []);
    useEffect(() => {
        const user = users.data?.users.find(item => item.id === activeUser);
        setRenameUserName(user?.name ?? '');
    }, [activeUser, users.data]);
    useEffect(() => {
        if (viewerProfiles.data !== undefined) viewerProfileStore.syncProfiles(viewerProfiles.data.profiles);
    }, [viewerProfiles.data]);
    useEffect(() => {
        setViewerProfilePassword('');
        setUnlockPassword('');
        setMisskeyAuthorization(null);
        setNiconicoCookies('');
    }, [linkedViewerProfile?.id]);

    const addUser = useMutation({
        mutationFn: api.addUser,
        onSuccess: async userId => {
            await queryClient.invalidateQueries({ queryKey: ['users'] });
            activeUserStore.save(userId);
            setNewUserName('');
            notify('ユーザーを追加しました', 'success');
        },
        onError: error => notify(`ユーザーの追加に失敗しました: ${error.message}`, 'error'),
    });
    const renameUser = useMutation({
        mutationFn: ({ userId, name }: { userId: number; name: string }) => api.updateUser(userId, name),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['users'] });
            notify('ユーザー名を変更しました', 'success');
        },
        onError: error => notify(`ユーザー名の変更に失敗しました: ${error.message}`, 'error'),
    });
    const deleteUser = useMutation({
        mutationFn: async ({ userId, profileId, password }: { userId: number; profileId?: number; password?: string }) => {
            if (profileId !== undefined && password !== undefined) {
                const session = await api.unlockViewerProfile(profileId, normalizeViewerProfilePassword(password));
                viewerProfileStore.unlock(profileId, session.sessionToken);
            }
            await api.deleteUser(userId);
        },
        onSuccess: async (_, { userId, profileId }) => {
            viewerProfileStore.forgetUser(userId, profileId);
            activeUserStore.save('master');
            setDeleteUserConfirmOpen(false);
            setDeleteUserPassword('');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['users'] }),
                queryClient.invalidateQueries({ queryKey: ['viewer-profiles'] }),
                queryClient.invalidateQueries({ queryKey: ['annict'] }),
                queryClient.invalidateQueries({ queryKey: ['twitter'] }),
                queryClient.invalidateQueries({ queryKey: ['bluesky'] }),
                queryClient.invalidateQueries({ queryKey: ['misskey'] }),
                queryClient.invalidateQueries({ queryKey: ['niconico'] }),
            ]);
            notify('ユーザーを削除しました', 'success');
        },
        onError: error => notify(`ユーザーを削除できませんでした: ${error.message}`, 'error'),
    });
    const saveAnnictToken = useMutation({
        mutationFn: api.setAnnictToken,
        onSuccess: async () => {
            setAnnictToken('');
            await queryClient.invalidateQueries({ queryKey: ['annict'] });
            notify('Annictへ接続しました', 'success');
        },
        onError: error => notify(`Annictへの接続に失敗しました: ${error.message}`, 'error'),
    });
    const removeAnnictToken = useMutation({
        mutationFn: api.deleteAnnictToken,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['annict'] });
            notify('Annict連携を解除しました', 'success');
        },
        onError: error => notify(`Annict連携の解除に失敗しました: ${error.message}`, 'error'),
    });
    const saveAnnictWriteToken = useMutation({
        mutationFn: api.setAnnictWriteToken,
        onSuccess: async () => {
            setAnnictWriteToken('');
            await queryClient.invalidateQueries({ queryKey: ['annict'] });
            notify('Annict書き込み連携を設定しました', 'success');
        },
        onError: error => notify(`Annict書き込み連携に失敗しました: ${error.message}`, 'error'),
    });
    const removeAnnictWriteToken = useMutation({
        mutationFn: api.deleteAnnictWriteToken,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['annict'] });
            notify('Annict書き込み連携を解除しました', 'success');
        },
        onError: error => notify(`Annict書き込み連携の解除に失敗しました: ${error.message}`, 'error'),
    });
    const connectTwitter = useMutation({
        mutationFn: () => api.connectTwitter(twitterCookies, navigator.userAgent),
        onSuccess: async status => {
            setTwitterCookies('');
            await queryClient.invalidateQueries({ queryKey: ['twitter'] });
            notify(`Twitterアカウント @${status.account?.screenName ?? ''} と連携しました`, 'success');
        },
        onError: error => notify(`Twitterアカウントとの連携に失敗しました: ${error.message}`, 'error'),
    });
    const disconnectTwitter = useMutation({
        mutationFn: api.disconnectTwitter,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['twitter'] });
            notify('Twitterアカウント連携を解除しました', 'success');
        },
        onError: error => notify(`Twitterアカウント連携を解除できませんでした: ${error.message}`, 'error'),
    });
    const connectBluesky = useMutation({
        mutationFn: () => api.connectBluesky(blueskyHandle, blueskyAppPassword),
        onSuccess: async status => {
            setBlueskyHandle('');
            setBlueskyAppPassword('');
            await queryClient.invalidateQueries({ queryKey: ['bluesky'] });
            notify(`Blueskyアカウント @${status.account?.handle ?? ''} と連携しました`, 'success');
        },
        onError: error => notify(`Blueskyアカウントとの連携に失敗しました: ${error.message}`, 'error'),
    });
    const disconnectBluesky = useMutation({
        mutationFn: api.disconnectBluesky,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['bluesky'] });
            notify('Blueskyアカウント連携を解除しました', 'success');
        },
        onError: error => notify(`Blueskyアカウント連携を解除できませんでした: ${error.message}`, 'error'),
    });
    const startMisskeyAuthorization = useMutation({
        mutationFn: () => api.startMisskeyAuthorization(misskeyVisibility),
        onSuccess: authorization => {
            setMisskeyAuthorization(authorization);
            window.open(authorization.authorizationUrl, '_blank', 'noopener,noreferrer');
            notify('Misskey.ioの認証画面を開きました。許可後、この画面で認証完了を確認してください', 'info');
        },
        onError: error => notify(`Misskey.ioの認証を開始できませんでした: ${error.message}`, 'error'),
    });
    const checkMisskeyAuthorization = useMutation({
        mutationFn: () => {
            if (misskeyAuthorization === null) throw new Error('認証を最初からやり直してください');
            return api.checkMisskeyAuthorization(misskeyAuthorization.sessionId);
        },
        onSuccess: async result => {
            if (!result.completed || result.status === undefined) {
                notify('Misskey.io側の認証がまだ完了していません', 'warning');
                return;
            }
            setMisskeyAuthorization(null);
            await queryClient.invalidateQueries({ queryKey: ['misskey'] });
            notify(`Misskey.ioアカウント @${result.status.account?.username ?? ''}@misskey.io と連携しました`, 'success');
        },
        onError: error => notify(`Misskey.ioの認証を確認できませんでした: ${error.message}`, 'error'),
    });
    const disconnectMisskey = useMutation({
        mutationFn: api.disconnectMisskey,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['misskey'] });
            notify('Misskey.ioアカウント連携を解除しました', 'success');
        },
        onError: error => notify(`Misskey.ioアカウント連携を解除できませんでした: ${error.message}`, 'error'),
    });
    const connectNiconico = useMutation({
        mutationFn: () => api.loginNiconico(niconicoCookies),
        onSuccess: async result => {
            setNiconicoCookies('');
            await queryClient.invalidateQueries({ queryKey: ['niconico'] });
            notify(`ニコニコアカウント「${result.account?.name ?? ''}」と連携しました`, 'success');
        },
        onError: error => notify(`ニコニコアカウントとの連携に失敗しました: ${error.message}`, 'error'),
    });
    const disconnectNiconico = useMutation({
        mutationFn: api.disconnectNiconico,
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['niconico'] });
            notify('ニコニコアカウント連携を解除しました', 'success');
        },
        onError: error => notify(`ニコニコアカウント連携を解除できませんでした: ${error.message}`, 'error'),
    });

    const addViewerProfile = useMutation({
        mutationFn: async () => {
            const password = newViewerProfileUseLock ? normalizeViewerProfilePassword(newViewerProfilePassword) : undefined;
            const profileId = await api.addViewerProfile(activeUser as number, password);
            if (password === undefined) return { profileId };
            const session = await api.unlockViewerProfile(profileId, password);
            return { profileId, sessionToken: session.sessionToken, recoveryCode: session.recoveryCode };
        },
        onSuccess: async ({ profileId, sessionToken, recoveryCode: issuedRecoveryCode }) => {
            viewerProfileStore.linkUser(activeUser as number, profileId);
            if (sessionToken !== undefined) viewerProfileStore.unlock(profileId, sessionToken);
            if (issuedRecoveryCode !== undefined) setRecoveryCode(issuedRecoveryCode);
            await queryClient.invalidateQueries({ queryKey: ['viewer-profiles'] });
            setNewViewerProfileUseLock(false);
            setNewViewerProfilePassword('');
            notify('このユーザーの外部連携を有効にしました', 'success');
        },
        onError: error => notify(`外部連携の有効化に失敗しました: ${error.message}`, 'error'),
    });
    const unlockViewerProfile = useMutation({
        mutationFn: () => api.unlockViewerProfile(activeViewerProfile.profileId as number, normalizeViewerProfilePassword(unlockPassword)),
        onSuccess: async session => {
            viewerProfileStore.unlock(activeViewerProfile.profileId as number, session.sessionToken);
            if (session.recoveryCode !== undefined) setRecoveryCode(session.recoveryCode);
            setUnlockPassword('');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['viewer-profiles'] }),
                queryClient.invalidateQueries({ queryKey: ['annict'] }),
                queryClient.invalidateQueries({ queryKey: ['twitter'] }),
                queryClient.invalidateQueries({ queryKey: ['bluesky'] }),
                queryClient.invalidateQueries({ queryKey: ['misskey'] }),
                queryClient.invalidateQueries({ queryKey: ['niconico'] }),
            ]);
            notify('ユーザーの外部連携ロックを解除しました', 'success');
        },
        onError: error => notify(`ロック解除に失敗しました: ${error.message}`, 'error'),
    });
    const updateViewerProfileLock = useMutation({
        mutationFn: (password?: string) =>
            api.updateViewerProfileLock(linkedViewerProfile?.id as number, password === undefined ? undefined : normalizeViewerProfilePassword(password)),
        onSuccess: async session => {
            viewerProfileStore.unlock(linkedViewerProfile?.id as number, session.sessionToken);
            if (session.recoveryCode !== undefined) setRecoveryCode(session.recoveryCode);
            setViewerProfilePassword('');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['viewer-profiles'] }),
                queryClient.invalidateQueries({ queryKey: ['annict'] }),
                queryClient.invalidateQueries({ queryKey: ['twitter'] }),
                queryClient.invalidateQueries({ queryKey: ['bluesky'] }),
                queryClient.invalidateQueries({ queryKey: ['misskey'] }),
                queryClient.invalidateQueries({ queryKey: ['niconico'] }),
            ]);
            notify('外部連携ロックを更新しました。他の端末の解除状態は無効になりました', 'success');
        },
        onError: error => notify(`外部連携ロックを更新できませんでした: ${error.message}`, 'error'),
    });
    const rotateViewerProfileRecoveryCode = useMutation({
        mutationFn: () => api.rotateViewerProfileRecoveryCode(linkedViewerProfile?.id as number),
        onSuccess: async result => {
            setRecoveryRotateConfirmOpen(false);
            setRecoveryCode(result.recoveryCode);
            await queryClient.invalidateQueries({ queryKey: ['viewer-profiles'] });
            notify('新しい回復コードを発行しました。以前のコードは無効です', 'success');
        },
        onError: error => notify(`回復コードを発行できませんでした: ${error.message}`, 'error'),
    });
    const switchActiveUser = useMutation({
        mutationFn: () => api.unlockViewerProfile(pendingActiveUser?.profileId as number, normalizeViewerProfilePassword(activeUserPassword)),
        onSuccess: async session => {
            const target = pendingActiveUser;
            if (target === null) return;
            viewerProfileStore.unlock(target.profileId, session.sessionToken);
            if (session.recoveryCode !== undefined) setRecoveryCode(session.recoveryCode);
            activeUserStore.save(target.userId);
            setPendingActiveUser(null);
            setActiveUserPassword('');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['viewer-profiles'] }),
                queryClient.invalidateQueries({ queryKey: ['annict'] }),
                queryClient.invalidateQueries({ queryKey: ['twitter'] }),
                queryClient.invalidateQueries({ queryKey: ['bluesky'] }),
                queryClient.invalidateQueries({ queryKey: ['misskey'] }),
                queryClient.invalidateQueries({ queryKey: ['niconico'] }),
            ]);
        },
        onError: error => notify(`ユーザーを切り替えられませんでした: ${error.message}`, 'error'),
    });

    const selectActiveUser = (userId: ActiveUserId): void => {
        if (userId === activeUser) return;
        if (typeof userId !== 'number') {
            activeUserStore.save(userId);
            return;
        }
        if (!viewerProfiles.isSuccess) {
            notify('ユーザーの連携状態を確認できないため、切り替えられません', 'error');
            return;
        }
        const profile = viewerProfiles.data.profiles.find(item => item.tvUserId === userId);
        if (profile?.lockRequired === true && viewerProfileStore.selectionForUser(userId).sessionToken === undefined) {
            setActiveUserPassword('');
            setPendingActiveUser({ userId, profileId: profile.id, name: users.data?.users.find(user => user.id === userId)?.name ?? profile.name });
            return;
        }
        activeUserStore.save(userId);
    };

    const applyPastedToken = (target: 'read' | 'write', value: string): void => {
        if (target === 'read') setAnnictToken(value.trim());
        else setAnnictWriteToken(value.trim());
    };
    const pasteToken = async (target: 'read' | 'write'): Promise<void> => {
        if (!window.isSecureContext) {
            setPasteFallbackReason('insecure');
            setPasteValue('');
            setPasteTarget(target);
            return;
        }
        if (navigator.clipboard === undefined) {
            setPasteFallbackReason('unavailable');
            setPasteValue('');
            setPasteTarget(target);
            return;
        }

        try {
            applyPastedToken(target, await navigator.clipboard.readText());
        } catch (err: unknown) {
            setPasteFallbackReason(err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'permission' : 'failed');
            setPasteValue('');
            setPasteTarget(target);
        }
    };

    const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
        setDraft(current => ({ ...current, [key]: value }));
    };
    const save = (): void => {
        settingsStore.save(draft);
        notify('設定を保存しました', 'success');
    };
    const encoderItems: WatchStreamEncoderSetting[] = ['Config', ...(config.data?.watchConfig?.availableEncoders ?? [])].filter(
        (value, index, array) => array.indexOf(value) === index,
    ) as WatchStreamEncoderSetting[];
    const qualityItems = config.data?.watchConfig?.liveQualities ?? [];

    return (
        <>
            <PageHeader
                title="設定"
                actions={
                    <Button
                        variant="contained"
                        startIcon={<SaveOutlined />}
                        onClick={() => {
                            if (activeSettingsTab === 'discord') discordSettingsRef.current?.save();
                            else save();
                        }}
                    >
                        保存
                    </Button>
                }
            />
            <Box
                sx={{
                    width: 'min(1180px, 100%)',
                    mx: 'auto',
                    p: { xs: 1.5, md: 3 },
                    display: { xs: 'block', md: 'grid' },
                    gridTemplateColumns: { md: '220px minmax(0, 1fr)' },
                    gap: { xs: 2, md: 3 },
                    alignItems: 'start',
                }}
            >
                <Card
                    variant="outlined"
                    component="nav"
                    aria-label="設定カテゴリ"
                    sx={{
                        position: { md: 'sticky' },
                        top: { md: 76 },
                        minWidth: 0,
                        mb: { xs: 2, md: 0 },
                        overflow: 'hidden',
                    }}
                >
                    <Tabs
                        value={activeSettingsTab}
                        onChange={(_event, value: SettingsTab) => setActiveSettingsTab(value)}
                        orientation={isDesktopSettingsNavigation ? 'vertical' : 'horizontal'}
                        variant={isDesktopSettingsNavigation ? 'standard' : 'scrollable'}
                        scrollButtons="auto"
                        allowScrollButtonsMobile
                        aria-label="設定カテゴリ"
                        sx={{
                            minHeight: { xs: 52, md: 'auto' },
                            '& .MuiTabs-indicator': {
                                left: { md: 0 },
                                right: { md: 'auto' },
                                width: { md: 3 },
                            },
                            '& .MuiTab-root': {
                                minHeight: 52,
                                justifyContent: { md: 'flex-start' },
                                px: { xs: 2, md: 2.25 },
                                gap: 1,
                                whiteSpace: 'nowrap',
                            },
                        }}
                    >
                        {settingsTabs.map(tab => (
                            <Tab
                                key={tab.value}
                                value={tab.value}
                                label={tab.label}
                                icon={tab.icon}
                                iconPosition="start"
                                id={`settings-tab-${tab.value}`}
                                aria-controls={`settings-panel-${tab.value}`}
                            />
                        ))}
                    </Tabs>
                </Card>
                <Box role="tabpanel" id={`settings-panel-${activeSettingsTab}`} aria-labelledby={`settings-tab-${activeSettingsTab}`} sx={{ minWidth: 0 }}>
                    <Stack spacing={2}>
                        {activeSettingsTab === 'general' && (
                            <>
                                <SettingSection title="全般">
                                    <SettingRow
                                        title="PWA"
                                        description="PWAを有効化する（再読み込み後に反映）"
                                        control={<Switch checked={draft.isEnablePWA} onChange={event => patch('isEnablePWA', event.target.checked)} />}
                                    />
                                    <SettingRow
                                        title="アイコン"
                                        description="favicon、PWA、iOSで使用するアイコンを選択します。"
                                        control={
                                            <FormControl size="small" sx={{ width: { xs: '100%', sm: 300 } }}>
                                                <InputLabel>アイコン</InputLabel>
                                                <Select
                                                    label="アイコン"
                                                    value={draft.appIconSet}
                                                    onChange={event => patch('appIconSet', event.target.value as AppIconSetId)}
                                                    renderValue={value => {
                                                        const iconSet = getAppIconSet(value);
                                                        return (
                                                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                                                <Box
                                                                    component="img"
                                                                    src={appIconAssetUrl(iconSet.original)}
                                                                    alt=""
                                                                    sx={{ width: 30, height: 30, objectFit: 'contain' }}
                                                                />
                                                                <Box component="span">{iconSet.label}</Box>
                                                            </Stack>
                                                        );
                                                    }}
                                                >
                                                    {appIconSets.map(iconSet => (
                                                        <MenuItem key={iconSet.id} value={iconSet.id}>
                                                            <Stack direction="row" spacing={1.25} sx={{ minWidth: 0, alignItems: 'center' }}>
                                                                <Box
                                                                    component="img"
                                                                    src={appIconAssetUrl(iconSet.original)}
                                                                    alt=""
                                                                    sx={{ width: 34, height: 34, objectFit: 'contain' }}
                                                                />
                                                                <Typography variant="body2">{iconSet.label}</Typography>
                                                            </Stack>
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        }
                                    />
                                    <SettingRow
                                        title="ロゴアイコンを連動する"
                                        description="左上とダッシュボードのロゴを、選択中のアイコンへ連動させます。"
                                        control={<Switch checked={draft.isAppLogoLinkedToIcon} onChange={event => patch('isAppLogoLinkedToIcon', event.target.checked)} />}
                                    />
                                    <SettingRow
                                        title="ロゴを消す"
                                        description="左上とダッシュボードの画面内ロゴを非表示にします。"
                                        control={<Switch checked={draft.isAppLogoHidden} onChange={event => patch('isAppLogoHidden', event.target.checked)} />}
                                    />
                                    <SettingRow
                                        title="OSカラーテーマ"
                                        description="OSのカラーテーマに連動させる"
                                        control={<Switch checked={draft.shouldUseOSColorTheme} onChange={event => patch('shouldUseOSColorTheme', event.target.checked)} />}
                                    />
                                    <SettingRow
                                        title="ダークテーマ"
                                        description="ダークテーマを有効化する"
                                        control={
                                            <Switch
                                                checked={draft.isForceDarkTheme}
                                                disabled={draft.shouldUseOSColorTheme}
                                                onChange={event => patch('isForceDarkTheme', event.target.checked)}
                                            />
                                        }
                                    />
                                    <SettingRow
                                        title="テーマカラー"
                                        description="画面のアクセントカラーを選択します。"
                                        control={
                                            <FormControl size="small" sx={{ width: { xs: '100%', sm: 300 } }}>
                                                <InputLabel>テーマカラー</InputLabel>
                                                <Select
                                                    label="テーマカラー"
                                                    value={draft.themeColorPreset}
                                                    onChange={event => patch('themeColorPreset', event.target.value as AppThemePresetId)}
                                                    renderValue={value => {
                                                        const preset = appThemePresets.find(item => item.id === value) ?? appThemePresets[0];
                                                        return (
                                                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                                                <ThemePresetSwatch color={preset.id === 'custom' ? draft.customThemeColor : preset.preview} />
                                                                <Box component="span">{preset.label}</Box>
                                                            </Stack>
                                                        );
                                                    }}
                                                >
                                                    {appThemePresets.map(preset => (
                                                        <MenuItem key={preset.id} value={preset.id}>
                                                            <Stack direction="row" spacing={1.25} sx={{ minWidth: 0, alignItems: 'center' }}>
                                                                <ThemePresetSwatch color={preset.id === 'custom' ? draft.customThemeColor : preset.preview} />
                                                                <Typography variant="body2">{preset.label}</Typography>
                                                            </Stack>
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        }
                                    />
                                    {draft.themeColorPreset === 'custom' && (
                                        <SettingRow
                                            title="カスタムカラー"
                                            control={<CustomThemeColorControl value={draft.customThemeColor} onChange={value => patch('customThemeColor', value)} />}
                                        />
                                    )}
                                    <SettingRow
                                        title="ライトモードのエッジを強調する"
                                        description="ライトモード時にカードや区切り線の境界を見やすくする"
                                        control={
                                            <Switch checked={draft.isEmphasizeLightThemeEdges} onChange={event => patch('isEmphasizeLightThemeEdges', event.target.checked)} />
                                        }
                                    />
                                    <SettingRow
                                        title="半角表示"
                                        description="強制的に半角表示にする"
                                        control={<Switch checked={draft.isHalfWidthDisplayed} onChange={event => patch('isHalfWidthDisplayed', event.target.checked)} />}
                                    />
                                </SettingSection>
                                <SettingSection title="サイドメニュー">
                                    <SideNavigationSettings
                                        order={draft.sideNavigationOrder}
                                        hiddenItems={draft.hiddenSideNavigationItems}
                                        onOrderChange={value => patch('sideNavigationOrder', value)}
                                        onHiddenItemsChange={value => patch('hiddenSideNavigationItems', value)}
                                    />
                                </SettingSection>
                                <SettingSection title="カスタムCSS">
                                    <SettingRow
                                        title="カスタムCSSを有効にする"
                                        description="このブラウザでNeoEPGStationの表示をCSSでカスタマイズします。"
                                        control={<Switch checked={draft.isCustomCssEnabled} onChange={event => patch('isCustomCssEnabled', event.target.checked)} />}
                                    />
                                    <TextField
                                        fullWidth
                                        multiline
                                        minRows={10}
                                        maxRows={24}
                                        label="カスタムCSS"
                                        placeholder={'例:\n[data-page-header="true"] {\n    border-bottom: 2px solid currentColor;\n}'}
                                        value={draft.customCss}
                                        disabled={isCustomCssDisabledByUrl()}
                                        onChange={event => patch('customCss', event.target.value)}
                                        helperText={
                                            isCustomCssDisabledByUrl()
                                                ? 'URLの指定によりカスタムCSSを無効化しています。'
                                                : '入力内容はすぐにプレビューされ、ヘッダーの「保存」でこのブラウザに保存されます。信頼できないCSSは貼り付けないでください。表示が崩れた場合は # 以降の画面URLへ ?disable-custom-css=1 を付けて開けます（例: /#/settings?disable-custom-css=1）。'
                                        }
                                        slotProps={{ htmlInput: { maxLength: 100000, spellCheck: false, autoComplete: 'off' } }}
                                        sx={{ mt: 1.5, '& textarea': { fontFamily: 'monospace', fontSize: '0.875rem', lineHeight: 1.55 } }}
                                    />
                                    <Stack direction="row" sx={{ mt: 1.5, justifyContent: 'flex-end' }}>
                                        <Button color="inherit" disabled={draft.customCss.length === 0} onClick={() => patch('customCss', '')}>
                                            入力内容をクリア
                                        </Button>
                                    </Stack>
                                </SettingSection>
                            </>
                        )}

                        {activeSettingsTab === 'viewing' && (
                            <>
                                <SettingSection title="視聴">
                                    <SettingRow
                                        title="エンコーダー"
                                        description="ライブ視聴とstreamingで使用するエンコーダー"
                                        control={
                                            <FormControl size="small" sx={{ minWidth: 220 }}>
                                                <InputLabel>エンコーダー</InputLabel>
                                                <Select
                                                    label="エンコーダー"
                                                    value={draft.watchStreamEncoder}
                                                    onChange={event => patch('watchStreamEncoder', event.target.value as WatchStreamEncoderSetting)}
                                                >
                                                    {encoderItems.map(item => (
                                                        <MenuItem key={item} value={item}>
                                                            {item}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        }
                                    />
                                    <SettingRow
                                        title="デフォルト画質"
                                        description="ライブ視聴のデフォルト画質"
                                        control={
                                            <FormControl size="small" sx={{ minWidth: 220 }}>
                                                <InputLabel>画質</InputLabel>
                                                <Select
                                                    label="画質"
                                                    value={draft.watchDefaultQuality ?? ''}
                                                    onChange={event => patch('watchDefaultQuality', event.target.value || null)}
                                                >
                                                    <MenuItem value="">自動</MenuItem>
                                                    {qualityItems.map(item => (
                                                        <MenuItem key={item} value={item}>
                                                            {item}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        }
                                    />
                                    <SettingRow
                                        title="HEVCでエンコード"
                                        description="ライブ視聴と録画済みSTREAMINGのエンコードをHEVCで行います"
                                        control={<Switch checked={draft.watchUseHevc} onChange={event => patch('watchUseHevc', event.target.checked)} />}
                                    />
                                    {isAppleMobileWebKit() && (
                                        <SettingRow
                                            title="WebKit再生互換モード"
                                            description="この端末で使用する自動再生方式を選択します"
                                            control={
                                                <FormControl size="small" sx={{ minWidth: 220 }}>
                                                    <InputLabel>再生方式</InputLabel>
                                                    <Select
                                                        label="再生方式"
                                                        value={draft.webkitPlaybackMode}
                                                        onChange={event => patch('webkitPlaybackMode', event.target.value as AppSettings['webkitPlaybackMode'])}
                                                    >
                                                        <MenuItem value="standard">標準</MenuItem>
                                                        <MenuItem value="ios26">iOS 26互換</MenuItem>
                                                    </Select>
                                                </FormControl>
                                            }
                                        />
                                    )}
                                    <SettingRow
                                        title="低遅延モード"
                                        description="ライブ視聴を自動的に低遅延のM2TS-LLで開始します"
                                        control={<Switch checked={draft.watchLowLatency} onChange={event => patch('watchLowLatency', event.target.checked)} />}
                                    />
                                    <SettingRow
                                        title="STREAMING開始バッファ"
                                        description="低速なエンコーダー向けに、先頭3セグメントを生成してからSTREAMINGを開始します"
                                        control={
                                            <Switch checked={draft.watchStreamingBufferedStart} onChange={event => patch('watchStreamingBufferedStart', event.target.checked)} />
                                        }
                                    />
                                    <SettingRow
                                        title="優先字幕"
                                        description="上から順に照合し、最初に一致した字幕をPLAYとSTREAMINGで選択します。"
                                        control={
                                            <SubtitlePriorityControl
                                                values={draft.watchSubtitlePreferredKeywords}
                                                onChange={values => patch('watchSubtitlePreferredKeywords', values)}
                                            />
                                        }
                                    />
                                    <SettingRow
                                        title="STREAMING字幕サイズ"
                                        description="焼き込み字幕の文字サイズを元の字幕に対する割合で調整します。"
                                        control={
                                            <PercentSlider
                                                value={draft.watchStreamingSubtitleSizePercent}
                                                minimum={50}
                                                maximum={250}
                                                step={5}
                                                onChange={value => patch('watchStreamingSubtitleSizePercent', value)}
                                            />
                                        }
                                    />
                                    <SettingRow
                                        title="STREAMING字幕の不透明度"
                                        description="焼き込み字幕の文字色の不透明度を元の字幕に対する割合で調整します。"
                                        control={
                                            <PercentSlider
                                                value={draft.watchStreamingSubtitleOpacityPercent}
                                                minimum={10}
                                                maximum={300}
                                                step={5}
                                                onChange={value => patch('watchStreamingSubtitleOpacityPercent', value)}
                                            />
                                        }
                                    />
                                    <SettingRow
                                        title="STREAMING字幕の縁取り幅"
                                        description="焼き込み字幕の縁取り幅を元の字幕に対する割合で調整します。"
                                        control={
                                            <PercentSlider
                                                value={draft.watchStreamingSubtitleOutlineSizePercent}
                                                minimum={0}
                                                maximum={300}
                                                step={10}
                                                onChange={value => patch('watchStreamingSubtitleOutlineSizePercent', value)}
                                            />
                                        }
                                    />
                                    <SettingRow
                                        title="STREAMING字幕の縁取り不透明度"
                                        description="焼き込み字幕の縁取り色の不透明度を元の字幕に対する割合で調整します。"
                                        control={
                                            <PercentSlider
                                                value={draft.watchStreamingSubtitleOutlineOpacityPercent}
                                                minimum={0}
                                                maximum={300}
                                                step={5}
                                                onChange={value => patch('watchStreamingSubtitleOutlineOpacityPercent', value)}
                                            />
                                        }
                                    />
                                    <SettingRow
                                        title="PLAY字幕をdanmakuで表示"
                                        description="オンにするとPLAYの字幕をDPlayerのdanmakuで表示し、オフにするとlibassで表示します。"
                                        control={<Switch checked={draft.watchPlaySubtitleDanmaku} onChange={event => patch('watchPlaySubtitleDanmaku', event.target.checked)} />}
                                    />
                                    <SettingRow
                                        title="danmakuを高リフレッシュレートで描画（実験的機能）"
                                        description="WebGL2でコメント画像をまとめて描画し、ブラウザが通知する更新頻度で動かします。WebGL2を利用できない環境では従来の描画方式へ自動的に戻ります。"
                                        control={
                                            <Switch checked={draft.watchDanmakuHighRefreshRate} onChange={event => patch('watchDanmakuHighRefreshRate', event.target.checked)} />
                                        }
                                    />
                                    <SettingRow
                                        title="danmaku描画フレームレート上限"
                                        description="Chromiumが異なるリフレッシュレートのモニターを正しく判別できない場合に、コメント描画の上限を指定します。自動ではブラウザの測定値を使用します。"
                                        control={
                                            <FormControl size="small" sx={{ minWidth: 220 }}>
                                                <InputLabel>描画上限</InputLabel>
                                                <Select
                                                    label="描画上限"
                                                    value={draft.watchDanmakuFrameRateLimit}
                                                    onChange={event => patch('watchDanmakuFrameRateLimit', event.target.value as AppSettings['watchDanmakuFrameRateLimit'])}
                                                >
                                                    <MenuItem value="auto">自動</MenuItem>
                                                    <MenuItem value="60">60 fps</MenuItem>
                                                    <MenuItem value="72">72 fps</MenuItem>
                                                    <MenuItem value="120">120 fps</MenuItem>
                                                    <MenuItem value="144">144 fps</MenuItem>
                                                </Select>
                                            </FormControl>
                                        }
                                    />
                                    <SettingRow
                                        title="下部再生UIを常時表示"
                                        description="映像の下に再生操作を常時表示します。上部・中央UIは従来どおり必要なときだけ表示します。"
                                        control={
                                            <Switch
                                                checked={draft.watchPersistentBottomControls}
                                                onChange={event => patch('watchPersistentBottomControls', event.target.checked)}
                                            />
                                        }
                                    />
                                    <SettingRow
                                        title="音量をパーセント表示"
                                        description="プレイヤーの再生ボタンと音量ボタンの間に現在の音量を表示します。"
                                        control={<Switch checked={draft.watchShowVolumePercent} onChange={event => patch('watchShowVolumePercent', event.target.checked)} />}
                                    />
                                    <SettingRow
                                        title="音量ブースト"
                                        description="プレイヤーの音量を100%より大きくできるようにします。大音量による聴覚やスピーカーへの負担に注意してください。"
                                        control={<Switch checked={draft.watchVolumeBoostEnabled} onChange={event => patch('watchVolumeBoostEnabled', event.target.checked)} />}
                                    />
                                    <SettingRow
                                        title="音量ブーストの最大値"
                                        description="音量バーで選べる最大値を100～200%の範囲で設定します。"
                                        control={
                                            <TextField
                                                type="number"
                                                size="small"
                                                value={draft.watchVolumeBoostMaxPercent}
                                                disabled={!draft.watchVolumeBoostEnabled}
                                                onChange={event => patch('watchVolumeBoostMaxPercent', Number(event.target.value))}
                                                slotProps={{ htmlInput: { min: 100, max: 200, step: 1 } }}
                                                sx={{ width: 120 }}
                                            />
                                        }
                                    />
                                    <SettingRow
                                        title="リジューム再生"
                                        description="PLAY／STREAMINGの再生位置を現在のEPGStationユーザーごとに保存し、次回同じ位置から再開します"
                                        control={<Switch checked={draft.watchResumePlayback} onChange={event => patch('watchResumePlayback', event.target.checked)} />}
                                    />
                                    <SettingRow
                                        title="字幕の縁取り"
                                        description="Webプレイヤーの字幕へ縁取りを付けて読みやすくする"
                                        control={
                                            <Switch checked={draft.isForceEnableSubtitleStroke} onChange={event => patch('isForceEnableSubtitleStroke', event.target.checked)} />
                                        }
                                    />
                                    <SettingRow
                                        title="録画済みのWeb再生を優先"
                                        description="エンコード済みファイルがある場合、録画詳細のPLAYでWebプレイヤーを優先する"
                                        control={<Switch checked={draft.isPreferredPlayingOnWeb} onChange={event => patch('isPreferredPlayingOnWeb', event.target.checked)} />}
                                    />
                                </SettingSection>

                                <SettingSection title="URL Scheme">
                                    <SettingRow
                                        title="放映中の視聴URL Scheme"
                                        description="オンにするとURL Schemeを優先し、オフにするとWeb視聴を優先します。URLが空欄ならconfig.ymlのOS別設定を使用します。"
                                        control={
                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, width: { sm: 480 }, maxWidth: '100%' }}>
                                                <Switch
                                                    checked={!draft.isPreferredPlayingLiveM2TSOnWeb}
                                                    onChange={event => patch('isPreferredPlayingLiveM2TSOnWeb', !event.target.checked)}
                                                />
                                                <TextField
                                                    size="small"
                                                    fullWidth
                                                    disabled={draft.isPreferredPlayingLiveM2TSOnWeb}
                                                    placeholder="例: vlc://PROTOCOL://ADDRESS"
                                                    value={draft.onAirM2TSViewURLScheme ?? ''}
                                                    onChange={event => patch('onAirM2TSViewURLScheme', event.target.value.length === 0 ? null : event.target.value)}
                                                />
                                            </Stack>
                                        }
                                    />
                                    <SettingRow
                                        title="録画済みの視聴URL Scheme"
                                        description="録画済みファイルを外部アプリで開くURLを生成します。空欄ならconfig.ymlのOS別設定を使用します。"
                                        control={
                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, width: { sm: 480 }, maxWidth: '100%' }}>
                                                <Switch
                                                    checked={draft.shouldUseRecordedViewURLScheme}
                                                    onChange={event => patch('shouldUseRecordedViewURLScheme', event.target.checked)}
                                                />
                                                <TextField
                                                    size="small"
                                                    fullWidth
                                                    disabled={!draft.shouldUseRecordedViewURLScheme}
                                                    placeholder="視聴URL Scheme"
                                                    value={draft.recordedViewURLScheme ?? ''}
                                                    onChange={event => patch('recordedViewURLScheme', event.target.value.length === 0 ? null : event.target.value)}
                                                />
                                            </Stack>
                                        }
                                    />
                                    <SettingRow
                                        title="録画済みのダウンロードURL Scheme"
                                        description="ダウンロード操作を外部アプリへ渡すURLを生成します。空欄ならconfig.ymlのOS別設定を使用します。"
                                        control={
                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, width: { sm: 480 }, maxWidth: '100%' }}>
                                                <Switch
                                                    checked={draft.shouldUseRecordedDownloadURLScheme}
                                                    onChange={event => patch('shouldUseRecordedDownloadURLScheme', event.target.checked)}
                                                />
                                                <TextField
                                                    size="small"
                                                    fullWidth
                                                    disabled={!draft.shouldUseRecordedDownloadURLScheme}
                                                    placeholder="ダウンロードURL Scheme"
                                                    value={draft.recordedDownloadURLScheme ?? ''}
                                                    onChange={event => patch('recordedDownloadURLScheme', event.target.value.length === 0 ? null : event.target.value)}
                                                />
                                            </Stack>
                                        }
                                    />
                                </SettingSection>
                            </>
                        )}

                        {activeSettingsTab === 'display' && (
                            <SettingSection title="表示設定">
                                <SettingRow
                                    title="バージョン更新通知"
                                    description="ダッシュボードに新しい安定版があることを表示する"
                                    control={
                                        <Switch
                                            checked={draft.isShowVersionUpdateNotification}
                                            onChange={event => patch('isShowVersionUpdateNotification', event.target.checked)}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="放映中を放送波ごとのタブで表示"
                                    description="放映中を一つの一覧ではなく、地デジ・BS・CSなどのタブへ分ける"
                                    control={<Switch checked={draft.isOnAirTabListView} onChange={event => patch('isOnAirTabListView', event.target.checked)} />}
                                />
                                <SettingRow
                                    title="番組表の描画設定"
                                    control={
                                        <FormControl size="small" sx={{ minWidth: 220 }}>
                                            <InputLabel>描画設定</InputLabel>
                                            <Select label="描画設定" value={draft.guideMode} onChange={event => patch('guideMode', event.target.value as AppSettings['guideMode'])}>
                                                <MenuItem value="sequential">順次描画</MenuItem>
                                                <MenuItem value="minimum">最小描画</MenuItem>
                                                <MenuItem value="all">全描画</MenuItem>
                                            </Select>
                                        </FormControl>
                                    }
                                />
                                <SettingRow
                                    title="番組表の表示時間"
                                    description="一度に取得・表示する時間"
                                    control={
                                        <TextField
                                            type="number"
                                            size="small"
                                            value={draft.guideLength}
                                            onChange={event => patch('guideLength', Math.max(1, Number(event.target.value)))}
                                            slotProps={{ htmlInput: { min: 1 } }}
                                            sx={{ width: 120 }}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="ダークテーマの配色を無効化する"
                                    description="ダークテーマ使用時でも通常時と同じ配色設定になります"
                                    control={
                                        <Switch
                                            checked={draft.isForceDisableDarkThemeForGuide}
                                            onChange={event => patch('isForceDisableDarkThemeForGuide', event.target.checked)}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="無料放送のみ表示"
                                    control={<Switch checked={draft.isShowOnlyFreePrograms} onChange={event => patch('isShowOnlyFreePrograms', event.target.checked)} />}
                                />
                                <SettingRow
                                    title="案内・データ局を表示"
                                    description="番組表と放映中に、NHKデータ・案内専用・音声専用チャンネルなども表示する"
                                    control={<Switch checked={draft.isShowInformationalChannels} onChange={event => patch('isShowInformationalChannels', event.target.checked)} />}
                                />
                                <SettingRow
                                    title="放送波種別表示"
                                    description="ナビゲーションの表示を放送波別に分ける"
                                    control={
                                        <Switch
                                            checked={draft.isEnableDisplayForEachBroadcastWave}
                                            onChange={event => patch('isEnableDisplayForEachBroadcastWave', event.target.checked)}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="番組からの検索に放送局を含める"
                                    description="番組表の番組ダイアログから検索した際、その番組と同じ放送局へ絞り込む"
                                    control={
                                        <Switch
                                            checked={draft.isIncludeChannelIdWhenSearching}
                                            onChange={event => patch('isIncludeChannelIdWhenSearching', event.target.checked)}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="番組からの検索にジャンルを含める"
                                    description="番組表の番組ダイアログから検索した際、その番組の大ジャンル・小ジャンルへ絞り込む"
                                    control={<Switch checked={draft.isIncludeGenreWhenSearching} onChange={event => patch('isIncludeGenreWhenSearching', event.target.checked)} />}
                                />
                                <SettingRow
                                    title="録画済みをテーブル表示"
                                    control={<Switch checked={draft.isShowTableMode} onChange={event => patch('isShowTableMode', event.target.checked)} />}
                                />
                                <SettingRow
                                    title="録画済みへ戻った番組を強調表示"
                                    description="録画詳細から一覧へ戻った際、元の録画を約1秒間ハイライトします。"
                                    control={<Switch checked={draft.isHighlightRecordedOnReturn} onChange={event => patch('isHighlightRecordedOnReturn', event.target.checked)} />}
                                />
                                <SettingRow
                                    title="録画済み表示件数"
                                    control={
                                        <TextField
                                            type="number"
                                            size="small"
                                            value={draft.recordedLength}
                                            onChange={event => patch('recordedLength', Number(event.target.value))}
                                            slotProps={{ htmlInput: { min: 1 } }}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="予約表示件数"
                                    control={
                                        <TextField
                                            type="number"
                                            size="small"
                                            value={draft.reservesLength}
                                            onChange={event => patch('reservesLength', Math.max(1, Number(event.target.value)))}
                                            slotProps={{ htmlInput: { min: 1 } }}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="録画中表示件数"
                                    control={
                                        <TextField
                                            type="number"
                                            size="small"
                                            value={draft.recordingLength}
                                            onChange={event => patch('recordingLength', Math.max(1, Number(event.target.value)))}
                                            slotProps={{ htmlInput: { min: 1 } }}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="ルール表示件数"
                                    control={
                                        <TextField
                                            type="number"
                                            size="small"
                                            value={draft.rulesLength}
                                            onChange={event => patch('rulesLength', Math.max(1, Number(event.target.value)))}
                                            slotProps={{ htmlInput: { min: 1 } }}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="検索最大表示件数"
                                    control={
                                        <TextField
                                            type="number"
                                            size="small"
                                            value={draft.searchLength}
                                            onChange={event => patch('searchLength', Number(event.target.value))}
                                            slotProps={{ htmlInput: { min: 1 } }}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="視聴履歴の保存件数"
                                    description="EPGStationユーザーごとに保持する録画番組の視聴履歴件数"
                                    control={
                                        <TextField
                                            type="number"
                                            size="small"
                                            value={draft.watchHistoryLength}
                                            onChange={event => patch('watchHistoryLength', Number(event.target.value))}
                                            slotProps={{ htmlInput: { min: 1, max: 200, step: 1 } }}
                                            sx={{ width: 120 }}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="録画済み一覧にドロップ情報を表示"
                                    description="概要の代わりにdrop・error・scramblingを表示する"
                                    control={
                                        <Switch
                                            checked={draft.isShowDropInfoInsteadOfDescription}
                                            onChange={event => patch('isShowDropInfoInsteadOfDescription', event.target.checked)}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="削除時に録画ファイルを初期選択"
                                    description="録画情報の削除ダイアログを開いた時、録画ファイルを最初から選択する"
                                    control={<Switch checked={draft.deleteRecordedDefaultValue} onChange={event => patch('deleteRecordedDefaultValue', event.target.checked)} />}
                                />
                            </SettingSection>
                        )}

                        {activeSettingsTab === 'search-rule' && (
                            <SettingSection title="検索・ルール">
                                <SettingRow
                                    title="自動スクロール"
                                    description="ルール編集時に検索結果へ自動スクロールする"
                                    control={
                                        <Switch
                                            checked={draft.isEnableAutoScrollWhenEditingRule}
                                            onChange={event => patch('isEnableAutoScrollWhenEditingRule', event.target.checked)}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="自動サブディレクトリ設定"
                                    description="ルール作成時にキーワードをサブディレクトリにコピーする"
                                    control={
                                        <Switch checked={draft.isEnableCopyKeywordToDirectory} onChange={event => patch('isEnableCopyKeywordToDirectory', event.target.checked)} />
                                    }
                                />
                                <SettingRow
                                    title="録画済み番組を排除"
                                    description="ルール作成時に録画済み番組を排除をチェックする"
                                    control={<Switch checked={draft.isCheckAvoidDuplicate} onChange={event => patch('isCheckAvoidDuplicate', event.target.checked)} />}
                                />
                                <SettingRow
                                    title="エンコードの自動設定"
                                    description="ルール作成時にエンコード設定を自動で行う"
                                    control={
                                        <Switch
                                            checked={draft.isEnableEncodingSettingWhenCreateRule}
                                            onChange={event => patch('isEnableEncodingSettingWhenCreateRule', event.target.checked)}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="元ファイルの自動削除"
                                    description="ルール作成時に元ファイルの自動削除をチェックする"
                                    control={
                                        <Switch
                                            checked={draft.isCheckDeleteOriginalAfterEncode}
                                            onChange={event => patch('isCheckDeleteOriginalAfterEncode', event.target.checked)}
                                        />
                                    }
                                />
                            </SettingSection>
                        )}

                        {activeSettingsTab === 'account' && (
                            <>
                                <SettingSection title="ユーザー">
                                    {users.isError && <QueryLoadError label="ユーザー一覧" error={users.error} onRetry={() => void users.refetch()} />}
                                    <SettingRow
                                        title="現在のユーザー"
                                        description="このブラウザで使用する標準ユーザー"
                                        control={
                                            <FormControl size="small" sx={{ minWidth: 220 }}>
                                                <InputLabel>ユーザー</InputLabel>
                                                <Select label="ユーザー" value={activeUser ?? 'master'} onChange={event => selectActiveUser(event.target.value as ActiveUserId)}>
                                                    <MenuItem value="master">master（すべて）</MenuItem>
                                                    {users.data?.users.map(user => (
                                                        <MenuItem key={user.id} value={user.id}>
                                                            {user.name}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        }
                                    />
                                    {typeof activeUser === 'number' && (
                                        <>
                                            <SettingRow
                                                title="ユーザー名"
                                                control={
                                                    <Stack direction="row" spacing={1}>
                                                        <TextField size="small" value={renameUserName} onChange={event => setRenameUserName(event.target.value)} />
                                                        <Button
                                                            variant="outlined"
                                                            disabled={renameUserName.trim().length === 0 || renameUser.isPending}
                                                            onClick={() => renameUser.mutate({ userId: activeUser, name: renameUserName.trim() })}
                                                        >
                                                            変更
                                                        </Button>
                                                    </Stack>
                                                }
                                            />
                                            <SettingRow
                                                title="ユーザーを削除"
                                                description="現在のアクティブユーザーを削除します。録画済み、ルール、予約を所有するユーザーと最後の1ユーザーは削除できません。外部連携とユーザー別の視聴情報も削除されます。"
                                                control={
                                                    <Button
                                                        color="error"
                                                        variant="outlined"
                                                        startIcon={<DeleteOutlineOutlined />}
                                                        disabled={deleteUser.isPending || (users.data?.users.length ?? 0) <= 1}
                                                        onClick={() => {
                                                            setDeleteUserPassword('');
                                                            setDeleteUserConfirmOpen(true);
                                                        }}
                                                    >
                                                        このユーザーを削除
                                                    </Button>
                                                }
                                            />
                                        </>
                                    )}
                                    <SettingRow
                                        title="新規ユーザー"
                                        control={
                                            <Stack direction="row" spacing={1}>
                                                <TextField size="small" value={newUserName} onChange={event => setNewUserName(event.target.value)} />
                                                <Button
                                                    variant="outlined"
                                                    startIcon={<AddOutlined />}
                                                    disabled={newUserName.trim().length === 0 || addUser.isPending}
                                                    onClick={() => addUser.mutate(newUserName.trim())}
                                                >
                                                    追加
                                                </Button>
                                            </Stack>
                                        }
                                    />
                                </SettingSection>
                                <SettingSection title="ユーザーの外部連携">
                                    {viewerProfiles.isError && (
                                        <QueryLoadError label="外部連携プロフィール" error={viewerProfiles.error} onRetry={() => void viewerProfiles.refetch()} />
                                    )}
                                    <SettingRow
                                        title="対象ユーザー"
                                        description="設定画面で選択している既存ユーザーへ、Annict・Twitter・Bluesky・Misskey.io・ニコニコなどの個人用情報を任意で紐づけます。未連携のユーザーにはパスワードを要求しません。"
                                        control={<Typography color={linkedViewerProfile === undefined ? 'text.secondary' : 'success.main'}>{linkedViewerProfileStatus}</Typography>}
                                    />
                                    {linkedViewerProfile?.lockRequired === true && activeViewerProfile.sessionToken === undefined && (
                                        <>
                                            <Divider />
                                            <SettingRow
                                                title="外部連携のロック解除"
                                                description="このユーザーに保存された外部サービスの認証情報を使用するため、設定した連携パスワードを入力します。既存の6桁PINもそのまま使用できます。"
                                                control={
                                                    <Stack direction="row" spacing={1}>
                                                        <ViewerProfilePasswordField
                                                            size="small"
                                                            label="連携パスワード"
                                                            value={unlockPassword}
                                                            onChange={setUnlockPassword}
                                                            error={unlockPassword.length > 0 && unlockPasswordError !== null}
                                                            helperText={unlockPassword.length > 0 ? unlockPasswordError : undefined}
                                                            desktopWidth={260}
                                                        />
                                                        <Button
                                                            variant="contained"
                                                            disabled={unlockPasswordError !== null || unlockViewerProfile.isPending}
                                                            onClick={() => unlockViewerProfile.mutate()}
                                                        >
                                                            解除
                                                        </Button>
                                                    </Stack>
                                                }
                                            />
                                        </>
                                    )}
                                    {linkedViewerProfile !== undefined && (linkedViewerProfile.lockRequired === false || activeViewerProfile.sessionToken !== undefined) && (
                                        <>
                                            <Divider />
                                            <SettingRow
                                                title="外部連携ロック"
                                                description={
                                                    linkedViewerProfile.lockRequired
                                                        ? '連携パスワードを変更するか、ロックなしへ変更できます。更新すると、他の端末やブラウザの解除状態は無効になります。保存済みの外部サービス認証情報は維持されます。'
                                                        : '一人で使用する場合など、ロックなしでも外部連携を利用できます。必要になったときは日本語にも対応した連携パスワードで保護できます。'
                                                }
                                                control={
                                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                                        <ViewerProfilePasswordField
                                                            size="small"
                                                            label={linkedViewerProfile.lockRequired ? '新しい連携パスワード' : '設定する連携パスワード'}
                                                            value={viewerProfilePassword}
                                                            onChange={setViewerProfilePassword}
                                                            error={viewerProfilePassword.length > 0 && viewerProfilePasswordValidationError !== null}
                                                            helperText={
                                                                viewerProfilePassword.length > 0 ? viewerProfilePasswordValidationError : '英数字・記号・日本語を使用できます'
                                                            }
                                                            desktopWidth={280}
                                                        />
                                                        <Button
                                                            variant="outlined"
                                                            disabled={viewerProfilePasswordValidationError !== null || updateViewerProfileLock.isPending}
                                                            onClick={() => updateViewerProfileLock.mutate(viewerProfilePassword)}
                                                            sx={{ whiteSpace: 'nowrap' }}
                                                        >
                                                            {linkedViewerProfile.lockRequired ? 'パスワードを変更' : 'ロックを設定'}
                                                        </Button>
                                                        {linkedViewerProfile.lockRequired && (
                                                            <Button
                                                                color="warning"
                                                                disabled={updateViewerProfileLock.isPending}
                                                                onClick={() => updateViewerProfileLock.mutate(undefined)}
                                                                sx={{ whiteSpace: 'nowrap' }}
                                                            >
                                                                ロックを解除
                                                            </Button>
                                                        )}
                                                    </Stack>
                                                }
                                            />
                                        </>
                                    )}
                                    {linkedViewerProfile?.lockRequired === true && activeViewerProfile.sessionToken !== undefined && (
                                        <>
                                            <Divider />
                                            <SettingRow
                                                title="回復コード"
                                                description={
                                                    linkedViewerProfile.recoveryCodeConfigured
                                                        ? '連携パスワードを忘れた場合に、保存済みの外部連携資格情報を維持して復旧するためのコードです。再発行すると以前のコードは無効になります。'
                                                        : 'このプロフィールには回復コードがまだありません。発行したコードはEPGStationサーバーとは別の安全な場所へ保存してください。'
                                                }
                                                control={
                                                    <Button
                                                        variant="outlined"
                                                        disabled={rotateViewerProfileRecoveryCode.isPending}
                                                        onClick={() => {
                                                            if (linkedViewerProfile.recoveryCodeConfigured) setRecoveryRotateConfirmOpen(true);
                                                            else rotateViewerProfileRecoveryCode.mutate();
                                                        }}
                                                    >
                                                        {linkedViewerProfile.recoveryCodeConfigured ? '回復コードを再発行' : '回復コードを発行'}
                                                    </Button>
                                                }
                                            />
                                        </>
                                    )}
                                    {linkedViewerProfile?.lockRequired === true && typeof activeUser === 'number' && (
                                        <>
                                            <Divider />
                                            <SettingRow
                                                title="連携パスワードを忘れた場合"
                                                description="保存済みの外部連携資格情報を維持するには、サーバー上で回復コマンドを実行し、利用者本人が保管している回復コードを入力します。回復コードも失った場合は、資格情報を初期化してAnnict・Twitter・Bluesky・Misskey.io・ニコニコを再連携してください。"
                                                control={
                                                    <Stack spacing={1}>
                                                        <Box>
                                                            <Typography variant="caption" color="text.secondary">
                                                                回復コードがある場合
                                                            </Typography>
                                                            <Typography
                                                                component="code"
                                                                variant="body2"
                                                                sx={{ display: 'block', px: 1.5, py: 1, bgcolor: 'action.hover', borderRadius: 1, overflowWrap: 'anywhere' }}
                                                            >
                                                                npm run reset-viewer-lock -- --user-id {activeUser}
                                                            </Typography>
                                                        </Box>
                                                        <Box>
                                                            <Typography variant="caption" color="warning.main">
                                                                回復コードがない場合（外部連携資格情報を削除）
                                                            </Typography>
                                                            <Typography
                                                                component="code"
                                                                variant="body2"
                                                                sx={{ display: 'block', px: 1.5, py: 1, bgcolor: 'action.hover', borderRadius: 1, overflowWrap: 'anywhere' }}
                                                            >
                                                                npm run wipe-viewer-credentials -- --user-id {activeUser}
                                                            </Typography>
                                                        </Box>
                                                    </Stack>
                                                }
                                            />
                                        </>
                                    )}
                                    {viewerProfiles.isSuccess && typeof activeUser === 'number' && linkedViewerProfile === undefined && (
                                        <>
                                            <Divider />
                                            <SettingRow
                                                title="外部連携を有効にする"
                                                description="このユーザーへ個人用のAnnict・Twitter・Bluesky・Misskey.io・ニコニコ認証情報を紐づけます。認証情報はロックの有無にかかわらずサーバー上で暗号化されます。共有環境では外部連携ロックを利用できます。"
                                                control={
                                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    checked={newViewerProfileUseLock}
                                                                    onChange={event => {
                                                                        setNewViewerProfileUseLock(event.target.checked);
                                                                        if (!event.target.checked) setNewViewerProfilePassword('');
                                                                    }}
                                                                />
                                                            }
                                                            label="連携パスワードで保護する"
                                                        />
                                                        {newViewerProfileUseLock && (
                                                            <ViewerProfilePasswordField
                                                                size="small"
                                                                label="連携パスワード"
                                                                value={newViewerProfilePassword}
                                                                onChange={setNewViewerProfilePassword}
                                                                error={newViewerProfilePassword.length > 0 && newViewerProfilePasswordError !== null}
                                                                helperText={
                                                                    newViewerProfilePassword.length > 0 ? newViewerProfilePasswordError : '英数字・記号・日本語を使用できます'
                                                                }
                                                                desktopWidth={280}
                                                            />
                                                        )}
                                                        <Button
                                                            variant="outlined"
                                                            startIcon={<AddOutlined />}
                                                            disabled={(newViewerProfileUseLock && newViewerProfilePasswordError !== null) || addViewerProfile.isPending}
                                                            onClick={() => addViewerProfile.mutate()}
                                                            sx={{ whiteSpace: 'nowrap' }}
                                                        >
                                                            有効化
                                                        </Button>
                                                    </Stack>
                                                }
                                            />
                                        </>
                                    )}
                                </SettingSection>

                                <SettingSection title="Twitter連携">
                                    <SettingRow
                                        title="連携アカウント"
                                        description="視聴画面のTwitterパネル内で、検索・ホームタイムライン表示・投稿を利用します。連携先は現在選択中の視聴者プロフィールです。"
                                        control={
                                            twitterStatus.isPending ? (
                                                <Typography color="text.secondary">確認中…</Typography>
                                            ) : twitterStatus.isError ? (
                                                <QueryLoadError label="Twitter連携状態" error={twitterStatus.error} onRetry={() => void twitterStatus.refetch()} />
                                            ) : twitterStatus.data?.configured === true && twitterStatus.data.account !== undefined ? (
                                                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                                                    {twitterStatus.data.account.iconUrl !== undefined && (
                                                        <Box component="img" src={twitterStatus.data.account.iconUrl} alt="" sx={{ width: 36, height: 36, borderRadius: '50%' }} />
                                                    )}
                                                    <Box sx={{ minWidth: 0 }}>
                                                        <Typography variant="body2" noWrap>
                                                            {twitterStatus.data.account.name}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary" noWrap>
                                                            @{twitterStatus.data.account.screenName}
                                                        </Typography>
                                                    </Box>
                                                    <Button
                                                        color="error"
                                                        disabled={
                                                            disconnectTwitter.isPending ||
                                                            (linkedViewerProfile?.lockRequired === true && activeViewerProfile.sessionToken === undefined)
                                                        }
                                                        onClick={() => disconnectTwitter.mutate()}
                                                    >
                                                        解除
                                                    </Button>
                                                </Stack>
                                            ) : (
                                                <Typography color="text.secondary">{activeViewerProfile.profileId === null ? '外部連携を有効にしてください' : '未連携'}</Typography>
                                            )
                                        }
                                    />
                                    {!twitterStatus.isPending && !twitterStatus.isError && twitterStatus.data?.configured !== true && (
                                        <>
                                            <Divider />
                                            <SettingRow
                                                title="Cookieでアカウント連携"
                                                description="Web版TwitterへログインしたPC版Chromeから、Netscape形式のx.com用cookies.txtを取得して貼り付けます。CookieはNeoEPGStationサーバー上で暗号化して保存されます。"
                                                control={
                                                    <Stack spacing={1} sx={{ width: { xs: '100%', sm: 520 }, maxWidth: '100%' }}>
                                                        <TextField
                                                            multiline
                                                            minRows={4}
                                                            maxRows={8}
                                                            size="small"
                                                            value={twitterCookies}
                                                            placeholder="# Netscape HTTP Cookie File"
                                                            onChange={event => setTwitterCookies(event.target.value)}
                                                            fullWidth
                                                        />
                                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                                                            <Button
                                                                component="a"
                                                                href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                variant="text"
                                                                size="small"
                                                            >
                                                                Cookie取得用拡張機能
                                                            </Button>
                                                            <Box sx={{ flex: 1 }} />
                                                            <Button
                                                                variant="contained"
                                                                disabled={
                                                                    activeViewerProfile.profileId === null ||
                                                                    (linkedViewerProfile?.lockRequired === true && activeViewerProfile.sessionToken === undefined) ||
                                                                    twitterCookies.trim().length === 0 ||
                                                                    connectTwitter.isPending
                                                                }
                                                                onClick={() => connectTwitter.mutate()}
                                                            >
                                                                {connectTwitter.isPending ? '確認中…' : '連携'}
                                                            </Button>
                                                        </Stack>
                                                        <Typography variant="caption" color="text.secondary">
                                                            連携専用のシークレットウィンドウで対象アカウントだけにログインし、x.comのCookieをNetscape形式で取得してください。
                                                        </Typography>
                                                    </Stack>
                                                }
                                            />
                                        </>
                                    )}
                                </SettingSection>
                                <SettingSection title="Bluesky連携">
                                    <SettingRow
                                        title="連携アカウント"
                                        description="視聴画面のSNSパネル内で、検索・ホームタイムライン表示・投稿を利用します。複数SNSを連携した場合はパネル内で単独またはまとめて利用できます。"
                                        control={
                                            blueskyStatus.isPending ? (
                                                <Typography color="text.secondary">確認中…</Typography>
                                            ) : blueskyStatus.isError ? (
                                                <QueryLoadError label="Bluesky連携状態" error={blueskyStatus.error} onRetry={() => void blueskyStatus.refetch()} />
                                            ) : blueskyStatus.data?.configured === true && blueskyStatus.data.account !== undefined ? (
                                                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                                                    {blueskyStatus.data.account.iconUrl !== undefined && (
                                                        <Box component="img" src={blueskyStatus.data.account.iconUrl} alt="" sx={{ width: 36, height: 36, borderRadius: '50%' }} />
                                                    )}
                                                    <Box sx={{ minWidth: 0 }}>
                                                        <Typography variant="body2" noWrap>
                                                            {blueskyStatus.data.account.name}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary" noWrap>
                                                            @{blueskyStatus.data.account.handle}
                                                        </Typography>
                                                    </Box>
                                                    <Button
                                                        color="error"
                                                        disabled={
                                                            disconnectBluesky.isPending ||
                                                            (linkedViewerProfile?.lockRequired === true && activeViewerProfile.sessionToken === undefined)
                                                        }
                                                        onClick={() => disconnectBluesky.mutate()}
                                                    >
                                                        解除
                                                    </Button>
                                                </Stack>
                                            ) : (
                                                <Typography color="text.secondary">{activeViewerProfile.profileId === null ? '外部連携を有効にしてください' : '未連携'}</Typography>
                                            )
                                        }
                                    />
                                    {!blueskyStatus.isPending && !blueskyStatus.isError && blueskyStatus.data?.configured !== true && (
                                        <>
                                            <Divider />
                                            <SettingRow
                                                title="App Passwordでアカウント連携"
                                                description="BlueskyでNeoEPGStation専用のApp Passwordを発行し、ハンドルと一緒に入力します。通常のログインパスワードは入力しないでください。セッションはサーバー上で暗号化して保存されます。"
                                                control={
                                                    <Stack spacing={1} sx={{ width: { xs: '100%', sm: 520 }, maxWidth: '100%' }}>
                                                        <TextField
                                                            size="small"
                                                            label="Blueskyハンドル"
                                                            placeholder="example.bsky.social"
                                                            value={blueskyHandle}
                                                            onChange={event => setBlueskyHandle(event.target.value)}
                                                            fullWidth
                                                        />
                                                        <TextField
                                                            size="small"
                                                            type="password"
                                                            label="App Password"
                                                            placeholder="xxxx-xxxx-xxxx-xxxx"
                                                            value={blueskyAppPassword}
                                                            onChange={event => setBlueskyAppPassword(event.target.value)}
                                                            fullWidth
                                                        />
                                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                                                            <Button
                                                                component="a"
                                                                href="https://bsky.app/settings/app-passwords"
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                variant="text"
                                                                size="small"
                                                            >
                                                                App Passwordを発行
                                                            </Button>
                                                            <Box sx={{ flex: 1 }} />
                                                            <Button
                                                                variant="contained"
                                                                disabled={
                                                                    activeViewerProfile.profileId === null ||
                                                                    (linkedViewerProfile?.lockRequired === true && activeViewerProfile.sessionToken === undefined) ||
                                                                    blueskyHandle.trim().length === 0 ||
                                                                    !/^[a-z0-9]{4}(?:-[a-z0-9]{4}){3}$/i.test(blueskyAppPassword.trim()) ||
                                                                    connectBluesky.isPending
                                                                }
                                                                onClick={() => connectBluesky.mutate()}
                                                            >
                                                                {connectBluesky.isPending ? '確認中…' : '連携'}
                                                            </Button>
                                                        </Stack>
                                                    </Stack>
                                                }
                                            />
                                        </>
                                    )}
                                </SettingSection>
                                <SettingSection title="Misskey.io連携">
                                    <SettingRow
                                        title="連携アカウント"
                                        description="視聴画面のSNSパネル内で、ノート検索・ホームタイムライン表示・投稿を利用します。連携情報は現在の視聴者プロフィールに保存されます。"
                                        control={
                                            misskeyStatus.isPending ? (
                                                <Typography color="text.secondary">確認中…</Typography>
                                            ) : misskeyStatus.isError ? (
                                                <QueryLoadError label="Misskey.io連携状態" error={misskeyStatus.error} onRetry={() => void misskeyStatus.refetch()} />
                                            ) : misskeyStatus.data?.configured === true && misskeyStatus.data.account !== undefined ? (
                                                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                                                    {misskeyStatus.data.account.iconUrl !== undefined && (
                                                        <Box
                                                            component="img"
                                                            src={misskeyStatus.data.account.iconUrl}
                                                            alt=""
                                                            sx={{
                                                                width: 36,
                                                                height: 36,
                                                                borderRadius: '50%',
                                                            }}
                                                        />
                                                    )}
                                                    <Box sx={{ minWidth: 0 }}>
                                                        <Typography variant="body2" noWrap>
                                                            {misskeyStatus.data.account.name}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary" noWrap>
                                                            @{misskeyStatus.data.account.username}@misskey.io・
                                                            {misskeyStatus.data.visibility === 'public'
                                                                ? 'パブリック'
                                                                : misskeyStatus.data.visibility === 'followers'
                                                                  ? 'フォロワー'
                                                                  : 'ホーム'}
                                                        </Typography>
                                                    </Box>
                                                    <Button
                                                        color="error"
                                                        disabled={
                                                            disconnectMisskey.isPending ||
                                                            (linkedViewerProfile?.lockRequired === true && activeViewerProfile.sessionToken === undefined)
                                                        }
                                                        onClick={() => disconnectMisskey.mutate()}
                                                    >
                                                        解除
                                                    </Button>
                                                </Stack>
                                            ) : (
                                                <Typography color="text.secondary">{activeViewerProfile.profileId === null ? '外部連携を有効にしてください' : '未連携'}</Typography>
                                            )
                                        }
                                    />
                                    {!misskeyStatus.isPending && !misskeyStatus.isError && misskeyStatus.data?.configured !== true && (
                                        <>
                                            <Divider />
                                            <SettingRow
                                                title="MiAuthでアカウント連携"
                                                description="Misskey.ioの認証画面でNeoEPGStationによるアカウント情報の参照とノート投稿を許可します。アクセストークンはブラウザへ渡さず、サーバーが取得して暗号化保存します。"
                                                control={
                                                    <Stack
                                                        spacing={1}
                                                        sx={{
                                                            width: { xs: '100%', sm: 520 },
                                                            maxWidth: '100%',
                                                        }}
                                                    >
                                                        <FormControl size="small" fullWidth>
                                                            <InputLabel>ノートの公開範囲</InputLabel>
                                                            <Select
                                                                label="ノートの公開範囲"
                                                                value={misskeyVisibility}
                                                                onChange={event => setMisskeyVisibility(event.target.value as MisskeyVisibility)}
                                                            >
                                                                <MenuItem value="home">ホーム</MenuItem>
                                                                <MenuItem value="public">パブリック</MenuItem>
                                                                <MenuItem value="followers">フォロワー</MenuItem>
                                                            </Select>
                                                        </FormControl>
                                                        {misskeyAuthorization !== null && (
                                                            <Typography variant="body2" color="text.secondary">
                                                                Misskey.io側で認証を許可したあと、「認証完了を確認」を押してください。認証画面を閉じた場合は再度開けます。
                                                            </Typography>
                                                        )}
                                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                                                            {misskeyAuthorization !== null && (
                                                                <Button
                                                                    component="a"
                                                                    href={misskeyAuthorization.authorizationUrl}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    variant="text"
                                                                    size="small"
                                                                >
                                                                    認証画面を開く
                                                                </Button>
                                                            )}
                                                            <Box sx={{ flex: 1 }} />
                                                            {misskeyAuthorization === null ? (
                                                                <Button
                                                                    variant="contained"
                                                                    disabled={
                                                                        activeViewerProfile.profileId === null ||
                                                                        (linkedViewerProfile?.lockRequired === true && activeViewerProfile.sessionToken === undefined) ||
                                                                        startMisskeyAuthorization.isPending
                                                                    }
                                                                    onClick={() => startMisskeyAuthorization.mutate()}
                                                                >
                                                                    {startMisskeyAuthorization.isPending ? '開始中…' : 'Misskey.ioで連携'}
                                                                </Button>
                                                            ) : (
                                                                <Button
                                                                    variant="contained"
                                                                    disabled={checkMisskeyAuthorization.isPending}
                                                                    onClick={() => checkMisskeyAuthorization.mutate()}
                                                                >
                                                                    {checkMisskeyAuthorization.isPending ? '確認中…' : '認証完了を確認'}
                                                                </Button>
                                                            )}
                                                        </Stack>
                                                    </Stack>
                                                }
                                            />
                                        </>
                                    )}
                                </SettingSection>
                                <SettingSection title="ニコニコ実況連携">
                                    <SettingRow
                                        title="連携アカウント"
                                        description="放映中プレイヤーから、現在の視聴者プロフィールに連携したニコニコアカウントで実況コメントを投稿します。コメント受信は未連携でもNX-Jikkyoから利用できます。"
                                        control={
                                            niconicoStatus.isPending ? (
                                                <Typography color="text.secondary">確認中…</Typography>
                                            ) : niconicoStatus.isError ? (
                                                <QueryLoadError label="ニコニコ連携状態" error={niconicoStatus.error} onRetry={() => void niconicoStatus.refetch()} />
                                            ) : niconicoStatus.data?.configured === true && niconicoStatus.data.account !== undefined ? (
                                                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                                                    <ChatBubbleOutlineOutlined color="primary" />
                                                    <Box>
                                                        <Typography variant="body2">{niconicoStatus.data.account.name}</Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            Niconico User ID: {niconicoStatus.data.account.userId}
                                                            {niconicoStatus.data.account.isPremium ? '・プレミアム会員' : ''}
                                                        </Typography>
                                                    </Box>
                                                    <Button
                                                        color="error"
                                                        disabled={
                                                            disconnectNiconico.isPending ||
                                                            (linkedViewerProfile?.lockRequired === true && activeViewerProfile.sessionToken === undefined)
                                                        }
                                                        onClick={() => disconnectNiconico.mutate()}
                                                    >
                                                        解除
                                                    </Button>
                                                </Stack>
                                            ) : (
                                                <Stack spacing={1} sx={{ width: { xs: '100%', sm: 420 } }}>
                                                    {activeViewerProfile.profileId === null ? (
                                                        <Typography color="text.secondary" sx={{ textAlign: { sm: 'right' } }}>
                                                            外部連携を有効にしてください
                                                        </Typography>
                                                    ) : (
                                                        <>
                                                            <TextField
                                                                multiline
                                                                minRows={4}
                                                                maxRows={8}
                                                                size="small"
                                                                value={niconicoCookies}
                                                                placeholder="# Netscape HTTP Cookie File"
                                                                onChange={event => setNiconicoCookies(event.target.value)}
                                                                fullWidth
                                                            />
                                                            <Typography variant="caption" color="text.secondary">
                                                                ニコニコへ公式サイトでログインしたPC版Chromeから、Netscape形式のnicovideo.jp用cookies.txtを取得してください。CookieはNeoEPGStationサーバー上で暗号化して保存されます。
                                                            </Typography>
                                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                                                                <Button
                                                                    component="a"
                                                                    href="https://account.nicovideo.jp/login?site=niconico"
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    variant="text"
                                                                    size="small"
                                                                >
                                                                    ニコニコへログイン
                                                                </Button>
                                                                <Button
                                                                    component="a"
                                                                    href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    variant="text"
                                                                    size="small"
                                                                >
                                                                    Cookie取得用拡張機能
                                                                </Button>
                                                                <Box sx={{ flex: 1 }} />
                                                                <Button
                                                                    variant="contained"
                                                                    disabled={
                                                                        niconicoCookies.trim().length === 0 ||
                                                                        (linkedViewerProfile?.lockRequired === true && activeViewerProfile.sessionToken === undefined) ||
                                                                        connectNiconico.isPending
                                                                    }
                                                                    onClick={() => connectNiconico.mutate()}
                                                                >
                                                                    {connectNiconico.isPending ? '確認中…' : '連携'}
                                                                </Button>
                                                            </Stack>
                                                        </>
                                                    )}
                                                </Stack>
                                            )
                                        }
                                    />
                                </SettingSection>
                            </>
                        )}

                        {activeSettingsTab === 'annict' && (
                            <SettingSection title="Annict連携">
                                {annictStatus.isError && <QueryLoadError label="Annict連携状態" error={annictStatus.error} onRetry={() => void annictStatus.refetch()} />}
                                {config.data?.developerMode === true && (
                                    <>
                                        <SettingRow
                                            title="補完放送局"
                                            description="Annictに放送予定がない作品で、選択した放送局を検索・ルール作成の対象へ追加できるようにします。"
                                            control={
                                                <Box sx={{ width: { xs: '100%', sm: 460 } }}>
                                                    <ChannelSelector
                                                        multiple
                                                        options={channelOptions}
                                                        value={draft.annictSupplementalChannelIds}
                                                        onChange={value => patch('annictSupplementalChannelIds', value)}
                                                        loading={channels.isPending}
                                                        label="補完放送局"
                                                    />
                                                </Box>
                                            }
                                        />
                                        <Divider />
                                    </>
                                )}
                                <SettingRow
                                    title="読み取り専用アクセストークン"
                                    description={`アニメ作品と放送予定の取得に使用します。トークンはサーバーだけに保存されます。現在: ${annictStatus.isPending ? '確認中' : annictStatus.isError ? '取得失敗' : annictStatus.data?.configured === true ? '接続済み' : '未設定'}`}
                                    control={
                                        <Stack direction="row" spacing={1} sx={{ minWidth: { sm: 420 }, alignItems: 'center' }}>
                                            <TextField
                                                type="password"
                                                size="small"
                                                value={annictToken}
                                                placeholder="Annictアクセストークン"
                                                onChange={event => setAnnictToken(event.target.value)}
                                                fullWidth
                                            />
                                            <Tooltip title="クリップボードから貼り付け">
                                                <IconButton aria-label="読み取り専用トークンを貼り付け" onClick={() => void pasteToken('read')}>
                                                    <ContentPasteOutlined />
                                                </IconButton>
                                            </Tooltip>
                                            <Button
                                                variant="contained"
                                                disabled={annictToken.trim().length === 0 || saveAnnictToken.isPending}
                                                onClick={() => saveAnnictToken.mutate(annictToken)}
                                            >
                                                接続
                                            </Button>
                                            {annictStatus.data?.configured === true && (
                                                <Button color="error" disabled={removeAnnictToken.isPending} onClick={() => removeAnnictToken.mutate()}>
                                                    解除
                                                </Button>
                                            )}
                                        </Stack>
                                    }
                                />
                                <Divider />
                                <SettingRow
                                    title="書き込みアクセストークン"
                                    description={`アニメ経由のルール作成と視聴ステータス更新に使用します。読み取り用とは別にサーバーへ保存されます。現在: ${annictStatus.isPending ? '確認中' : annictStatus.isError ? '取得失敗' : annictStatus.data?.writeConfigured === true ? '接続済み' : '未設定'}`}
                                    control={
                                        <Stack direction="row" spacing={1} sx={{ minWidth: { sm: 420 }, alignItems: 'center' }}>
                                            <TextField
                                                type="password"
                                                size="small"
                                                value={annictWriteToken}
                                                placeholder="Annict書き込みアクセストークン"
                                                onChange={event => setAnnictWriteToken(event.target.value)}
                                                fullWidth
                                            />
                                            <Tooltip title="クリップボードから貼り付け">
                                                <IconButton aria-label="書き込みトークンを貼り付け" onClick={() => void pasteToken('write')}>
                                                    <ContentPasteOutlined />
                                                </IconButton>
                                            </Tooltip>
                                            <Button
                                                variant="contained"
                                                disabled={
                                                    activeViewerProfile.profileId === null ||
                                                    (linkedViewerProfile?.lockRequired === true && activeViewerProfile.sessionToken === undefined) ||
                                                    annictWriteToken.trim().length === 0 ||
                                                    saveAnnictWriteToken.isPending
                                                }
                                                onClick={() => saveAnnictWriteToken.mutate(annictWriteToken)}
                                            >
                                                接続
                                            </Button>
                                            {annictStatus.data?.writeConfigured === true && (
                                                <Button color="error" disabled={removeAnnictWriteToken.isPending} onClick={() => removeAnnictWriteToken.mutate()}>
                                                    解除
                                                </Button>
                                            )}
                                        </Stack>
                                    }
                                />
                                <Divider />
                                <SettingRow
                                    title="自動視聴記録"
                                    description="外部プレイヤーでは再生進捗を取得できないため、割合判定は内蔵PLAY／STREAMINGでのみ動作します"
                                    control={
                                        <FormControl size="small" sx={{ minWidth: 240 }}>
                                            <InputLabel>視聴判定</InputLabel>
                                            <Select
                                                label="視聴判定"
                                                value={draft.annictAutoWatchMode}
                                                onChange={event => patch('annictAutoWatchMode', event.target.value as AppSettings['annictAutoWatchMode'])}
                                            >
                                                <MenuItem value="disabled">自動記録しない</MenuItem>
                                                <MenuItem value="start">PLAY／STREAMING開始時</MenuItem>
                                                <MenuItem value="progress">指定割合まで視聴した時</MenuItem>
                                            </Select>
                                        </FormControl>
                                    }
                                />
                                {draft.annictAutoWatchMode === 'progress' && (
                                    <SettingRow
                                        title="視聴判定割合"
                                        description="シークを除き、実際に再生した累計時間がこの割合に達した時に記録します"
                                        control={
                                            <TextField
                                                type="number"
                                                size="small"
                                                value={draft.annictAutoWatchThresholdPercent}
                                                onChange={event => patch('annictAutoWatchThresholdPercent', Number(event.target.value))}
                                                slotProps={{ htmlInput: { min: 1, max: 100, step: 1 } }}
                                                sx={{ width: 120 }}
                                                label="%"
                                            />
                                        }
                                    />
                                )}
                                <SettingRow
                                    title="ダウンロード時の視聴記録"
                                    description="録画ファイルまたはプレイリストのdownloadを開始した時に、この話を見たと記録します"
                                    control={<Switch checked={draft.annictAutoWatchOnDownload} onChange={event => patch('annictAutoWatchOnDownload', event.target.checked)} />}
                                />
                                <SettingRow
                                    title="ルール無効化時に視聴中断扱いする"
                                    description="オフにすると、Annict経由の最後の有効ルールを無効にしても作品の視聴ステータスを変更しません"
                                    control={
                                        <Switch
                                            checked={draft.annictStopWatchingOnRuleDisable}
                                            onChange={event => patch('annictStopWatchingOnRuleDisable', event.target.checked)}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="最終話視聴後に作品を「見た」にする"
                                    description="EPGの最終回表示を最優先し、表示がない場合はAnnictのエピソード情報で最終話を確認して更新します"
                                    control={
                                        <Switch
                                            checked={draft.annictMarkWatchedOnFinalEpisode}
                                            onChange={event => patch('annictMarkWatchedOnFinalEpisode', event.target.checked)}
                                        />
                                    }
                                />
                                <SettingRow
                                    title="最終話視聴後にルールを無効化する"
                                    description="Annictに次話がなく、予約が残っていない、視聴したプロフィール所有のルールだけを無効化します"
                                    control={
                                        <Switch
                                            checked={draft.annictDisableRulesOnFinalEpisode}
                                            disabled={!draft.annictMarkWatchedOnFinalEpisode}
                                            onChange={event => patch('annictDisableRulesOnFinalEpisode', event.target.checked)}
                                        />
                                    }
                                />
                            </SettingSection>
                        )}
                        {activeSettingsTab === 'discord' && <DiscordSettingsPanel ref={discordSettingsRef} />}
                    </Stack>
                </Box>
            </Box>
            <Dialog open={pendingActiveUser !== null} onClose={() => setPendingActiveUser(null)} fullWidth maxWidth="xs">
                <DialogTitle>アクティブユーザーを切り替え</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        {pendingActiveUser?.name}
                        は外部連携パスワードで保護されています。切り替えるにはパスワードを入力してください。
                    </DialogContentText>
                    <ViewerProfilePasswordField
                        autoFocus
                        fullWidth
                        label="外部連携パスワード"
                        value={activeUserPassword}
                        onChange={setActiveUserPassword}
                        error={activeUserPassword.length > 0 && activeUserPasswordError !== null}
                        helperText={activeUserPassword.length > 0 ? activeUserPasswordError : undefined}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && activeUserPasswordError === null && !switchActiveUser.isPending) switchActiveUser.mutate();
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPendingActiveUser(null)}>キャンセル</Button>
                    <Button variant="contained" disabled={activeUserPasswordError !== null || switchActiveUser.isPending} onClick={() => switchActiveUser.mutate()}>
                        切り替え
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog open={pasteTarget !== null} onClose={() => setPasteTarget(null)} fullWidth maxWidth="sm">
                <DialogTitle>アクセストークンを貼り付け</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        {pasteFallbackReason === 'insecure' && '安全な接続ではないため、ブラウザがクリップボードの直接読み取りを許可しません。'}
                        {pasteFallbackReason === 'permission' && 'ブラウザでこのサイトのクリップボード読み取りが許可されていません。サイト設定で許可できます。'}
                        {pasteFallbackReason === 'unavailable' && 'このブラウザではクリップボードの直接読み取りを利用できません。'}
                        {pasteFallbackReason === 'failed' && 'クリップボードを直接読み取れませんでした。'}
                        この欄でCtrl+V、または長押しして貼り付けてください。
                    </DialogContentText>
                    <TextField
                        autoFocus
                        type="password"
                        fullWidth
                        label="Annictアクセストークン"
                        value={pasteValue}
                        onChange={event => setPasteValue(event.target.value)}
                        onPaste={event => {
                            const value = event.clipboardData.getData('text').trim();
                            if (pasteTarget !== null && value.length > 0) {
                                event.preventDefault();
                                applyPastedToken(pasteTarget, value);
                                setPasteTarget(null);
                            }
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPasteTarget(null)}>キャンセル</Button>
                    <Button
                        variant="contained"
                        disabled={pasteValue.trim().length === 0}
                        onClick={() => {
                            if (pasteTarget !== null) applyPastedToken(pasteTarget, pasteValue);
                            setPasteTarget(null);
                        }}
                    >
                        取り込む
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog open={recoveryRotateConfirmOpen} onClose={() => setRecoveryRotateConfirmOpen(false)} fullWidth maxWidth="xs">
                <DialogTitle>回復コードを再発行</DialogTitle>
                <DialogContent>
                    <DialogContentText>現在の回復コードは直ちに無効になります。新しいコードを安全な場所へ保存する準備ができてから続行してください。</DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRecoveryRotateConfirmOpen(false)}>キャンセル</Button>
                    <Button variant="contained" color="warning" disabled={rotateViewerProfileRecoveryCode.isPending} onClick={() => rotateViewerProfileRecoveryCode.mutate()}>
                        再発行
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog
                open={deleteUserConfirmOpen}
                onClose={() => {
                    if (!deleteUser.isPending) setDeleteUserConfirmOpen(false);
                }}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle>ユーザーを削除</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        ユーザー「{activeUserInfo?.name ?? ''}」を削除します。このユーザーの外部連携資格情報、回復コード、Annict視聴情報、再生進捗も削除され、元に戻せません。
                    </DialogContentText>
                    <DialogContentText sx={{ mb: 2 }}>録画済み、ルール、予約を所有している場合はサーバー側で削除を中止します。</DialogContentText>
                    {linkedViewerProfile?.lockRequired === true && (
                        <ViewerProfilePasswordField
                            autoFocus
                            fullWidth
                            label="外部連携パスワード"
                            value={deleteUserPassword}
                            onChange={setDeleteUserPassword}
                            error={deleteUserPassword.length > 0 && viewerProfilePasswordError(deleteUserPassword) !== null}
                            helperText={deleteUserPassword.length > 0 ? viewerProfilePasswordError(deleteUserPassword) : undefined}
                            onKeyDown={event => {
                                if (event.key === 'Enter' && typeof activeUser === 'number' && viewerProfilePasswordError(deleteUserPassword) === null && !deleteUser.isPending) {
                                    deleteUser.mutate({
                                        userId: activeUser,
                                        profileId: linkedViewerProfile.id,
                                        password: deleteUserPassword,
                                    });
                                }
                            }}
                        />
                    )}
                </DialogContent>
                <DialogActions>
                    <Button disabled={deleteUser.isPending} onClick={() => setDeleteUserConfirmOpen(false)}>
                        キャンセル
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        disabled={
                            typeof activeUser !== 'number' ||
                            activeUserInfo === undefined ||
                            (linkedViewerProfile?.lockRequired === true && viewerProfilePasswordError(deleteUserPassword) !== null) ||
                            deleteUser.isPending
                        }
                        onClick={() => {
                            if (typeof activeUser !== 'number') return;
                            deleteUser.mutate({
                                userId: activeUser,
                                profileId: linkedViewerProfile?.id,
                                password: linkedViewerProfile?.lockRequired === true ? deleteUserPassword : undefined,
                            });
                        }}
                    >
                        完全に削除
                    </Button>
                </DialogActions>
            </Dialog>
            <ViewerRecoveryCodeDialog recoveryCode={recoveryCode} onClose={() => setRecoveryCode(null)} />
        </>
    );
}
