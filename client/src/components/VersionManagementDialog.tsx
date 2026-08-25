import RestartAltOutlined from '@mui/icons-material/RestartAltOutlined';
import SystemUpdateAltOutlined from '@mui/icons-material/SystemUpdateAltOutlined';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    InputLabel,
    LinearProgress,
    MenuItem,
    Select,
    Stack,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SystemUpdatePackageManager, SystemUpdateTarget } from '../../../api';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';

interface Props {
    open: boolean;
    onClose: () => void;
}

const statusLabel: Record<string, string> = {
    running: '更新中',
    success: '成功',
    failed: '失敗',
    'rolled-back': '失敗（復旧済み）',
    'rollback-failed': '復旧失敗',
};

function relationSuffix(relation: string | undefined): string {
    if (relation === 'same') return '（更新済み）';
    if (relation === 'behind') return '（現在より古い）';
    if (relation === 'diverged') return '（別の履歴）';
    if (relation === 'unknown') return '（比較できません）';
    return '';
}

export function VersionManagementDialog({ open, onClose }: Props): ReactNode {
    const { notify } = useNotifications();
    const queryClient = useQueryClient();
    const [packageManager, setPackageManager] = useState<SystemUpdatePackageManager>('auto');
    const [preserveLocalChanges, setPreserveLocalChanges] = useState(false);
    const info = useQuery({
        queryKey: ['system-update'],
        queryFn: () => api.getSystemUpdateInfo(false),
        enabled: open,
        refetchInterval: query => (query.state.data?.job?.status === 'running' ? 2_000 : false),
    });
    useEffect(() => {
        if (info.data?.rememberedPackageManager !== null && info.data?.rememberedPackageManager !== undefined) {
            setPackageManager(info.data.rememberedPackageManager);
        }
    }, [info.data?.rememberedPackageManager]);

    const start = useMutation({
        mutationFn: (target: SystemUpdateTarget) => api.startSystemUpdate({ target, packageManager, preserveLocalChanges }),
        onSuccess: () => {
            notify('更新処理を開始しました', 'info');
            void queryClient.invalidateQueries({ queryKey: ['system-update'] });
        },
        onError: error => notify(`更新を開始できませんでした: ${error.message}`, 'error'),
    });
    const restart = useMutation({
        mutationFn: api.restartAfterSystemUpdate,
        onSuccess: () => notify('再起動を要求しました。しばらくしてから画面を再読み込みしてください', 'info'),
        onError: error => notify(`再起動できませんでした: ${error.message}`, 'error'),
    });
    const refresh = useMutation({
        mutationFn: () => api.getSystemUpdateInfo(true),
        onSuccess: data => queryClient.setQueryData(['system-update'], data),
        onError: error => notify(`更新情報を再取得できませんでした: ${error.message}`, 'error'),
    });
    const job = info.data?.job;
    const running = job?.status === 'running';

    const begin = (target: SystemUpdateTarget): void => {
        const label = target === 'stable' ? info.data?.targets.stable?.label : info.data?.targets.develop?.label;
        const localChangeNotice = preserveLocalChanges ? '未コミットの変更は退避され、更新後のファイルで上書きされます。' : '';
        if (!window.confirm(`${label ?? target} へ更新します。${localChangeNotice}DBとconfig.ymlのバックアップ後にコードを更新してビルドします。よろしいですか？`)) return;
        start.mutate(target);
    };

    return (
        <Dialog open={open} onClose={running ? undefined : onClose} fullWidth maxWidth="md">
            <DialogTitle>バージョン管理</DialogTitle>
            <DialogContent dividers>
                {info.isPending ? (
                    <LinearProgress />
                ) : info.isError ? (
                    <Alert severity="error">更新情報を取得できませんでした: {info.error.message}</Alert>
                ) : info.data !== undefined ? (
                    <Stack spacing={2.5}>
                        {info.data.gitError !== null && <Alert severity="error">Gitを実行できませんでした: {info.data.gitError}</Alert>}
                        {info.data.gitError === null && !info.data.isGitRepository && <Alert severity="warning">Git clone環境ではないためWeb UIから更新できません。</Alert>}
                        {info.data.gitError === null && info.data.isGitRepository && !info.data.isClean && (
                            <Alert severity="warning">
                                <Typography variant="body2">未コミットの変更があります。</Typography>
                                <Box component="pre" sx={{ m: 0, mt: 1, maxHeight: 120, overflow: 'auto', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                                    {info.data.dirtyFiles.join('\n')}
                                </Box>
                            </Alert>
                        )}
                        {info.data.targets.error !== null && <Alert severity="warning">最新情報の取得に失敗したため前回の情報を表示しています: {info.data.targets.error}</Alert>}
                        {info.data.targets.stable !== null && info.data.targets.stable.relation !== 'ahead' && (
                            <Alert severity="info">
                                安定版 {info.data.targets.stable.label} は
                                {info.data.targets.stable.relation === 'behind'
                                    ? '現在より古いため'
                                    : info.data.targets.stable.relation === 'same'
                                      ? '既に適用済みのため'
                                      : '現在の履歴の先にないため'}
                                更新対象にできません。
                            </Alert>
                        )}
                        <Box>
                            <Typography variant="overline" color="text.secondary">
                                現在
                            </Typography>
                            <Typography variant="h6">{info.data.currentTag ?? `v${info.data.version}`}</Typography>
                            <Typography variant="body2" color="text.secondary">
                                {info.data.branch ?? 'detached HEAD'} / {info.data.commit?.slice(0, 8) ?? '不明'}
                            </Typography>
                        </Box>
                        <FormControl size="small" sx={{ width: 240 }} disabled={running}>
                            <InputLabel>パッケージ管理</InputLabel>
                            <Select label="パッケージ管理" value={packageManager} onChange={event => setPackageManager(event.target.value as SystemUpdatePackageManager)}>
                                <MenuItem value="auto">自動判定（{info.data.packageManager}）</MenuItem>
                                <MenuItem value="npm">npm</MenuItem>
                                <MenuItem value="pnpm">pnpm</MenuItem>
                            </Select>
                        </FormControl>
                        {!info.data.isClean && info.data.gitError === null && info.data.isGitRepository && (
                            <FormControlLabel
                                control={<Checkbox checked={preserveLocalChanges} onChange={event => setPreserveLocalChanges(event.target.checked)} />}
                                label="未コミットの変更を退避して上書き更新する"
                            />
                        )}
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                            <Button
                                variant="contained"
                                startIcon={<SystemUpdateAltOutlined />}
                                disabled={
                                    running ||
                                    start.isPending ||
                                    info.data.gitError !== null ||
                                    !info.data.isGitRepository ||
                                    (!info.data.isClean && !preserveLocalChanges) ||
                                    info.data.targets.stable === null ||
                                    info.data.targets.stable.relation !== 'ahead'
                                }
                                onClick={() => begin('stable')}
                            >
                                安定版 {info.data.targets.stable?.label ?? '取得不可'}
                                {relationSuffix(info.data.targets.stable?.relation)} へ更新
                            </Button>
                            <Button
                                variant="outlined"
                                startIcon={<SystemUpdateAltOutlined />}
                                disabled={
                                    running ||
                                    start.isPending ||
                                    info.data.gitError !== null ||
                                    !info.data.isGitRepository ||
                                    (!info.data.isClean && !preserveLocalChanges) ||
                                    info.data.targets.develop === null ||
                                    info.data.targets.develop.relation !== 'ahead'
                                }
                                onClick={() => begin('develop')}
                            >
                                {info.data.targets.develop?.label ?? 'develop取得不可'}
                                {relationSuffix(info.data.targets.develop?.relation)} へ更新
                            </Button>
                            <Button disabled={running || refresh.isPending} onClick={() => refresh.mutate()}>
                                更新情報を再取得
                            </Button>
                        </Stack>
                        {job !== null && job !== undefined && (
                            <Stack spacing={1}>
                                <Typography variant="subtitle1">処理結果: {statusLabel[job.status] ?? job.status}</Typography>
                                {running && <LinearProgress />}
                                <Typography variant="body2">段階: {job.stage}</Typography>
                                {job.error !== null && <Alert severity={job.status === 'rolled-back' ? 'warning' : 'error'}>{job.error}</Alert>}
                                {job.stashCommit !== null && <Alert severity="info">更新前のローカル変更はstash {job.stashCommit.slice(0, 12)} に保存されています。</Alert>}
                                <Box
                                    component="pre"
                                    sx={{
                                        m: 0,
                                        p: 1.5,
                                        maxHeight: 300,
                                        overflow: 'auto',
                                        bgcolor: 'background.default',
                                        borderRadius: 1,
                                        fontSize: '0.75rem',
                                        whiteSpace: 'pre-wrap',
                                    }}
                                >
                                    {job.logs.join('\n')}
                                </Box>
                                {job.restartRequired && (
                                    <Alert
                                        severity="success"
                                        action={
                                            <Button color="inherit" startIcon={<RestartAltOutlined />} disabled={restart.isPending} onClick={() => restart.mutate()}>
                                                再起動
                                            </Button>
                                        }
                                    >
                                        更新は完了しています。サービス管理下で再起動すると新しいバージョンが反映されます。手動起動中は端末から再起動してください。
                                    </Alert>
                                )}
                            </Stack>
                        )}
                    </Stack>
                ) : null}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={running}>
                    閉じる
                </Button>
            </DialogActions>
        </Dialog>
    );
}
