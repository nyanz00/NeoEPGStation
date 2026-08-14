import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import { type ReactNode, useEffect, useState } from 'react';

interface ViewerRecoveryCodeDialogProps {
    recoveryCode: string | null;
    onClose: () => void;
}

export function ViewerRecoveryCodeDialog({ recoveryCode, onClose }: ViewerRecoveryCodeDialogProps): ReactNode {
    const [saved, setSaved] = useState(false);
    const [copyMessage, setCopyMessage] = useState<string | null>(null);

    useEffect(() => {
        setSaved(false);
        setCopyMessage(null);
    }, [recoveryCode]);

    const copy = async (): Promise<void> => {
        if (recoveryCode === null) return;
        try {
            await navigator.clipboard.writeText(recoveryCode);
            setCopyMessage('コピーしました');
        } catch {
            setCopyMessage('コピーできませんでした。コード欄を選択してコピーしてください');
        }
    };

    const download = (): void => {
        if (recoveryCode === null) return;
        const url = URL.createObjectURL(
            new Blob(
                [
                    [
                        'NeoEPGStation 外部連携回復コード',
                        '',
                        recoveryCode,
                        '',
                        'このコードは連携パスワードを忘れた場合に必要です。',
                        '第三者へ渡さず、安全な場所へ保管してください。',
                    ].join('\r\n'),
                ],
                { type: 'text/plain;charset=utf-8' },
            ),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = 'neoepgstation-recovery-code.txt';
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <Dialog
            open={recoveryCode !== null}
            onClose={() => {
                if (saved) onClose();
            }}
            fullWidth
            maxWidth="sm"
        >
            <DialogTitle>外部連携の回復コード</DialogTitle>
            <DialogContent>
                <Alert severity="warning" sx={{ mb: 2 }}>
                    このコードはこの画面を閉じると再表示できません。連携パスワードを忘れた場合、保存済みのAnnict・Twitter・Bluesky・Misskey.io・ニコニコ連携を維持して復旧するために必要です。
                </Alert>
                <DialogContentText sx={{ mb: 2 }}>
                    パスワードマネージャー、印刷、またはダウンロードしたファイルなど、EPGStationサーバーとは別の安全な場所へ保存してください。
                </DialogContentText>
                <TextField
                    fullWidth
                    value={recoveryCode ?? ''}
                    label="回復コード"
                    onFocus={event => event.currentTarget.select()}
                    slotProps={{ htmlInput: { readOnly: true } }}
                    sx={{ '& input': { fontFamily: 'monospace', letterSpacing: '0.08em' } }}
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
                    <Button startIcon={<ContentCopyOutlined />} onClick={() => void copy()}>
                        コピー
                    </Button>
                    <Button startIcon={<DownloadOutlined />} onClick={download}>
                        ファイルへ保存
                    </Button>
                </Stack>
                {copyMessage !== null && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {copyMessage}
                    </Typography>
                )}
                <FormControlLabel
                    sx={{ mt: 2 }}
                    control={<Checkbox checked={saved} onChange={event => setSaved(event.target.checked)} />}
                    label="回復コードを安全な場所へ保存しました"
                />
            </DialogContent>
            <DialogActions>
                <Button variant="contained" disabled={!saved} onClick={onClose}>
                    閉じる
                </Button>
            </DialogActions>
        </Dialog>
    );
}
