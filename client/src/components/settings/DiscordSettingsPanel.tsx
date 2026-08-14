import AddOutlined from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import { Alert, Box, Button, Card, CardContent, Divider, FormControl, InputLabel, MenuItem, Select, Stack, Switch, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { forwardRef, type ReactNode, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type {
    DiscordNotificationCondition,
    DiscordNotificationEvent,
    DiscordNotificationRule,
    UpdateDiscordNotificationDestination,
    UpdateDiscordNotificationSettings,
} from '../../../../api';
import { api } from '../../core/api/queries';
import { useNotifications } from '../../core/notifications/Notifications';

interface DestinationDraft extends UpdateDiscordNotificationDestination {
    configured: boolean;
}

const eventLabels: Record<DiscordNotificationEvent, string> = {
    recording_start: '録画開始',
    recording_finish: '録画終了',
    recording_failed: '録画失敗',
    encode_finish: 'エンコード成功',
    encode_failed: 'エンコード失敗',
};

const conditionFields: ReadonlyArray<{
    key: keyof DiscordNotificationCondition;
    label: string;
}> = [
    { key: 'dropMin', label: 'drop 最小' },
    { key: 'dropMax', label: 'drop 最大' },
    { key: 'errorMin', label: 'error 最小' },
    { key: 'errorMax', label: 'error 最大' },
    { key: 'scramblingMin', label: 'scrambling 最小' },
    { key: 'scramblingMax', label: 'scrambling 最大' },
];

function createId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface DiscordSettingsPanelHandle {
    save(): void;
}

export const DiscordSettingsPanel = forwardRef<DiscordSettingsPanelHandle>(function DiscordSettingsPanel(_props, ref): ReactNode {
    const { notify } = useNotifications();
    const queryClient = useQueryClient();
    const settings = useQuery({
        queryKey: ['discord', 'settings'],
        queryFn: api.getDiscordNotificationSettings,
    });
    const [enabled, setEnabled] = useState(false);
    const [destinations, setDestinations] = useState<DestinationDraft[]>([]);
    const [rules, setRules] = useState<DiscordNotificationRule[]>([]);

    useEffect(() => {
        if (settings.data === undefined) return;
        setEnabled(settings.data.enabled);
        setDestinations(
            settings.data.destinations.map(destination => ({
                id: destination.id,
                name: destination.name,
                username: destination.username,
                configured: destination.configured,
                webhookUrl: '',
                clearWebhook: false,
            })),
        );
        setRules(settings.data.rules);
    }, [settings.data]);

    const destinationOptions = useMemo(() => destinations.map(destination => ({ id: destination.id, name: destination.name })), [destinations]);

    const saveSettings = useMutation({
        mutationFn: (value: UpdateDiscordNotificationSettings) => api.updateDiscordNotificationSettings(value),
        onSuccess: async result => {
            queryClient.setQueryData(['discord', 'settings'], result);
            notify('Discord通知設定を保存しました', 'success');
        },
        onError: error => notify(`Discord通知設定を保存できませんでした: ${error.message}`, 'error'),
    });
    const testNotification = useMutation({
        mutationFn: api.testDiscordNotification,
        onSuccess: () => notify('Discordへテスト通知を送信しました', 'success'),
        onError: error => notify(`Discordテスト通知に失敗しました: ${error.message}`, 'error'),
    });

    const updateDestination = (index: number, patch: Partial<DestinationDraft>): void => {
        setDestinations(current => current.map((destination, currentIndex) => (currentIndex === index ? { ...destination, ...patch } : destination)));
    };

    const updateRule = (index: number, patch: Partial<DiscordNotificationRule>): void => {
        setRules(current => current.map((rule, currentIndex) => (currentIndex === index ? { ...rule, ...patch } : rule)));
    };

    const updateCondition = (index: number, key: keyof DiscordNotificationCondition, value: string): void => {
        const parsed = value === '' ? undefined : Math.max(0, Math.floor(Number(value)));
        setRules(current =>
            current.map((rule, currentIndex) => {
                if (currentIndex !== index) return rule;
                const condition = { ...(rule.condition ?? {}), [key]: Number.isFinite(parsed) ? parsed : undefined };
                for (const conditionKey of Object.keys(condition) as Array<keyof DiscordNotificationCondition>) {
                    if (condition[conditionKey] === undefined) delete condition[conditionKey];
                }
                return { ...rule, condition: Object.keys(condition).length === 0 ? undefined : condition };
            }),
        );
    };

    const moveRule = (index: number, offset: -1 | 1): void => {
        setRules(current => {
            const target = index + offset;
            if (target < 0 || target >= current.length) return current;
            const next = [...current];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const save = (): void => {
        if (settings.data === undefined || saveSettings.isPending) return;
        saveSettings.mutate({
            enabled,
            destinations: destinations.map(({ configured: _configured, ...destination }) => ({
                ...destination,
                webhookUrl: destination.webhookUrl?.trim() || undefined,
            })),
            rules,
        });
    };
    useImperativeHandle(ref, () => ({ save }));

    if (settings.isLoading) return <Typography color="text.secondary">Discord通知設定を読み込んでいます…</Typography>;
    if (settings.isError) return <Alert severity="error">Discord通知設定を読み込めませんでした: {settings.error.message}</Alert>;

    return (
        <Stack spacing={2}>
            <Card variant="outlined">
                <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
                    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                            <Typography component="h2" variant="h6">
                                Discord通知
                            </Typography>
                            <Typography variant="body2" color="text.disabled">
                                録画・エンコードの結果をDiscord Webhookへ直接送信します。
                            </Typography>
                        </Box>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
                            <Typography>{enabled ? '有効' : '無効'}</Typography>
                            <Switch checked={enabled} onChange={event => setEnabled(event.target.checked)} />
                        </Stack>
                    </Stack>
                </CardContent>
            </Card>
            <Alert severity="warning">
                config.ymlの録画・エンコード終了時コマンドは、この通知を有効にしても引き続き実行されます。移行確認後は、二重通知を避けるため従来のDiscord通知BATを呼ぶコマンド設定を解除してください。
            </Alert>

            <Card variant="outlined">
                <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
                    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                            <Typography component="h2" variant="h6">
                                送信プリセット
                            </Typography>
                            <Typography variant="body2" color="text.disabled">
                                Webhook URLはサーバー上で暗号化して保存され、保存後はWeb画面へ返しません。
                            </Typography>
                        </Box>
                        <Button
                            startIcon={<AddOutlined />}
                            onClick={() =>
                                setDestinations(current => [
                                    ...current,
                                    {
                                        id: createId('destination'),
                                        name: '新しい送信プリセット',
                                        username: 'NeoEPGStation',
                                        configured: false,
                                        webhookUrl: '',
                                        clearWebhook: false,
                                    },
                                ])
                            }
                        >
                            追加
                        </Button>
                    </Stack>
                    <Divider sx={{ my: 2 }} />
                    <Stack spacing={2}>
                        {destinations.map((destination, index) => (
                            <Card key={destination.id} variant="outlined">
                                <CardContent>
                                    <Stack spacing={1.5}>
                                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                                            <TextField
                                                fullWidth
                                                label="送信プリセット名"
                                                value={destination.name}
                                                onChange={event => updateDestination(index, { name: event.target.value })}
                                            />
                                            <TextField
                                                fullWidth
                                                label="Discord表示名"
                                                value={destination.username}
                                                onChange={event => updateDestination(index, { username: event.target.value })}
                                            />
                                        </Stack>
                                        <TextField
                                            fullWidth
                                            type="password"
                                            label={destination.configured && !destination.clearWebhook ? 'Webhook URL（設定済み・変更時のみ入力）' : 'Webhook URL'}
                                            value={destination.webhookUrl ?? ''}
                                            autoComplete="off"
                                            onChange={event =>
                                                updateDestination(index, {
                                                    webhookUrl: event.target.value,
                                                    clearWebhook: false,
                                                })
                                            }
                                        />
                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'flex-end' }}>
                                            <Button
                                                startIcon={<SendOutlined />}
                                                disabled={
                                                    testNotification.isPending ||
                                                    destination.clearWebhook === true ||
                                                    !destination.configured ||
                                                    (destination.webhookUrl ?? '').trim().length > 0
                                                }
                                                onClick={() => testNotification.mutate(destination.id)}
                                            >
                                                テスト送信
                                            </Button>
                                            <Button
                                                color="warning"
                                                disabled={!destination.configured || destination.clearWebhook === true}
                                                onClick={() => updateDestination(index, { clearWebhook: true, webhookUrl: '' })}
                                            >
                                                Webhookを解除
                                            </Button>
                                            <Button
                                                color="error"
                                                startIcon={<DeleteOutlineOutlined />}
                                                onClick={() => {
                                                    setDestinations(current => current.filter((_, currentIndex) => currentIndex !== index));
                                                    setRules(current => current.filter(rule => rule.destinationId !== destination.id));
                                                }}
                                            >
                                                送信プリセットを削除
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        ))}
                    </Stack>
                </CardContent>
            </Card>

            <Card variant="outlined">
                <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
                    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                            <Typography component="h2" variant="h6">
                                通知ルール
                            </Typography>
                            <Typography variant="body2" color="text.disabled">
                                同じタスクの同じイベントに対しては一件のみ通知を送信します。複数のルールに一致した場合は、一覧で最も上のルールを使用します。利用可能な変数:{' '}
                                {'{recordedId} {name} {channelName} {drop} {error} {scrambling} {mode} {encoderMessage}'}
                            </Typography>
                        </Box>
                        <Button
                            startIcon={<AddOutlined />}
                            disabled={destinations.length === 0}
                            onClick={() =>
                                setRules(current => [
                                    ...current,
                                    {
                                        id: createId('rule'),
                                        name: '新しい通知ルール',
                                        enabled: true,
                                        event: 'recording_finish',
                                        destinationId: destinations[0]?.id ?? '',
                                        message: '{name}',
                                    },
                                ])
                            }
                        >
                            追加
                        </Button>
                    </Stack>
                    <Divider sx={{ my: 2 }} />
                    <Stack spacing={2}>
                        {rules.map((rule, index) => (
                            <Card key={rule.id} variant="outlined">
                                <CardContent>
                                    <Stack spacing={1.5}>
                                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
                                            <Switch checked={rule.enabled} onChange={event => updateRule(index, { enabled: event.target.checked })} />
                                            <TextField fullWidth label="ルール名" value={rule.name} onChange={event => updateRule(index, { name: event.target.value })} />
                                            <FormControl fullWidth>
                                                <InputLabel>イベント</InputLabel>
                                                <Select
                                                    label="イベント"
                                                    value={rule.event}
                                                    onChange={event =>
                                                        updateRule(index, {
                                                            event: event.target.value as DiscordNotificationEvent,
                                                            condition: event.target.value === 'recording_finish' ? rule.condition : undefined,
                                                        })
                                                    }
                                                >
                                                    {Object.entries(eventLabels).map(([value, label]) => (
                                                        <MenuItem key={value} value={value}>
                                                            {label}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                            <FormControl fullWidth>
                                                <InputLabel>送信プリセット</InputLabel>
                                                <Select
                                                    label="送信プリセット"
                                                    value={rule.destinationId}
                                                    onChange={event => updateRule(index, { destinationId: event.target.value })}
                                                >
                                                    {destinationOptions.map(destination => (
                                                        <MenuItem key={destination.id} value={destination.id}>
                                                            {destination.name}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        </Stack>
                                        {rule.event === 'recording_finish' && (
                                            <Box
                                                sx={{
                                                    display: 'grid',
                                                    gridTemplateColumns: {
                                                        xs: 'repeat(2, minmax(0, 1fr))',
                                                        md: 'repeat(6, minmax(0, 1fr))',
                                                    },
                                                    gap: 1,
                                                }}
                                            >
                                                {conditionFields.map(field => (
                                                    <TextField
                                                        key={field.key}
                                                        type="number"
                                                        label={field.label}
                                                        value={rule.condition?.[field.key] ?? ''}
                                                        slotProps={{ htmlInput: { min: 0 } }}
                                                        onChange={event => updateCondition(index, field.key, event.target.value)}
                                                    />
                                                ))}
                                            </Box>
                                        )}
                                        <TextField
                                            fullWidth
                                            multiline
                                            minRows={2}
                                            label="メッセージ"
                                            value={rule.message}
                                            onChange={event => updateRule(index, { message: event.target.value })}
                                        />
                                        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                                            <Button disabled={index === 0} onClick={() => moveRule(index, -1)}>
                                                上へ
                                            </Button>
                                            <Button disabled={index === rules.length - 1} onClick={() => moveRule(index, 1)}>
                                                下へ
                                            </Button>
                                            <Button
                                                color="error"
                                                startIcon={<DeleteOutlineOutlined />}
                                                onClick={() => setRules(current => current.filter((_, currentIndex) => currentIndex !== index))}
                                            >
                                                削除
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        ))}
                    </Stack>
                </CardContent>
            </Card>
        </Stack>
    );
});
