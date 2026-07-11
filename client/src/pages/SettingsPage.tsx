import AddOutlined from '@mui/icons-material/AddOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import { Box, Button, Card, CardContent, Divider, FormControl, InputLabel, MenuItem, Select, Stack, Switch, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { api } from '../core/api/queries';
import { activeUserStore, useActiveUser, type ActiveUserId } from '../core/storage/activeUser';
import { type AppSettings, type WatchStreamEncoderSetting, settingsStore, useSettings } from '../core/storage/settings';
import { useNotifications } from '../core/notifications/Notifications';

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
                    <Typography variant="body2" color="text.secondary">
                        {description}
                    </Typography>
                )}
            </Box>
            <Box sx={{ minWidth: 0, justifySelf: { sm: 'end' }, width: { xs: '100%', sm: 'auto' } }}>{control}</Box>
        </Box>
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

export function SettingsPage(): ReactNode {
    const savedSettings = useSettings();
    const activeUser = useActiveUser();
    const [draft, setDraft] = useState<AppSettings>(savedSettings);
    const [newUserName, setNewUserName] = useState('');
    const [renameUserName, setRenameUserName] = useState('');
    const { notify } = useNotifications();
    const queryClient = useQueryClient();
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const users = useQuery({ queryKey: ['users'], queryFn: api.getUsers });

    useEffect(() => setDraft(savedSettings), [savedSettings]);
    useEffect(() => {
        const user = users.data?.users.find(item => item.id === activeUser);
        setRenameUserName(user?.name ?? '');
    }, [activeUser, users.data]);

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
                    <Button variant="contained" startIcon={<SaveOutlined />} onClick={save}>
                        保存
                    </Button>
                }
            />
            <Stack spacing={2} sx={{ width: 'min(920px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                <SettingSection title="全般">
                    <SettingRow
                        title="PWA"
                        description="PWAを有効化する（再読み込み後に反映）"
                        control={<Switch checked={draft.isEnablePWA} onChange={event => patch('isEnablePWA', event.target.checked)} />}
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
                            <Switch checked={draft.isForceDarkTheme} disabled={draft.shouldUseOSColorTheme} onChange={event => patch('isForceDarkTheme', event.target.checked)} />
                        }
                    />
                    <SettingRow
                        title="半角表示"
                        description="強制的に半角表示にする"
                        control={<Switch checked={draft.isHalfWidthDisplayed} onChange={event => patch('isHalfWidthDisplayed', event.target.checked)} />}
                    />
                    <SettingRow
                        title="現在のユーザー"
                        description="このブラウザで使用する標準ユーザー"
                        control={
                            <FormControl size="small" sx={{ minWidth: 220 }}>
                                <InputLabel>ユーザー</InputLabel>
                                <Select label="ユーザー" value={activeUser ?? 'master'} onChange={event => activeUserStore.save(event.target.value as ActiveUserId)}>
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
                                <Select label="画質" value={draft.watchDefaultQuality ?? ''} onChange={event => patch('watchDefaultQuality', event.target.value || null)}>
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
                        description="ライブ視聴のエンコードをHEVCで行います"
                        control={<Switch checked={draft.watchUseHevc} onChange={event => patch('watchUseHevc', event.target.checked)} />}
                    />
                    <SettingRow
                        title="低遅延モード"
                        description="ライブ視聴を自動的に低遅延のM2TS-LLで開始します"
                        control={<Switch checked={draft.watchLowLatency} onChange={event => patch('watchLowLatency', event.target.checked)} />}
                    />
                    <SettingRow
                        title="STREAMING優先字幕"
                        control={
                            <TextField size="small" value={draft.watchSubtitlePreferredKeyword} onChange={event => patch('watchSubtitlePreferredKeyword', event.target.value)} />
                        }
                    />
                    <SettingRow
                        title="PLAY優先字幕"
                        control={
                            <TextField
                                size="small"
                                value={draft.watchPlaySubtitlePreferredKeyword}
                                onChange={event => patch('watchPlaySubtitlePreferredKeyword', event.target.value)}
                            />
                        }
                    />
                </SettingSection>

                <SettingSection title="番組表・一覧">
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
                        title="無料放送のみ表示"
                        control={<Switch checked={draft.isShowOnlyFreePrograms} onChange={event => patch('isShowOnlyFreePrograms', event.target.checked)} />}
                    />
                    <SettingRow
                        title="録画済みをテーブル表示"
                        control={<Switch checked={draft.isShowTableMode} onChange={event => patch('isShowTableMode', event.target.checked)} />}
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
                </SettingSection>
            </Stack>
        </>
    );
}
