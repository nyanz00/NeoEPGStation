import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import ReplayOutlined from '@mui/icons-material/ReplayOutlined';
import { Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EncodeId, EncodeRecoveryItem } from '../../../api';
import { useState, type ReactNode } from 'react';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';

export function EncodeRecoverySection({ items }: { items: EncodeRecoveryItem[] }): ReactNode {
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const [deleteTarget, setDeleteTarget] = useState<EncodeRecoveryItem | null>(null);
    const retry = useMutation({
        mutationFn: (encodeId: EncodeId) => api.retryEncode(encodeId),
        onSuccess: async () => {
            notify('エンコードを再開しました', 'success');
            await queryClient.invalidateQueries({ queryKey: ['encode'] });
        },
        onError: async error => {
            notify(`エンコードを再開できませんでした: ${error.message}`, 'error');
            await queryClient.invalidateQueries({ queryKey: ['encode'] });
        },
    });
    const remove = useMutation({
        mutationFn: (encodeId: EncodeId) => api.cancelEncode(encodeId),
        onSuccess: async () => {
            setDeleteTarget(null);
            notify('要確認のエンコードタスクを削除しました', 'success');
            await queryClient.invalidateQueries({ queryKey: ['encode'] });
        },
        onError: async error => {
            notify(`要確認タスクを削除できませんでした: ${error.message}`, 'error');
            await queryClient.invalidateQueries({ queryKey: ['encode'] });
        },
    });

    if (items.length === 0) return null;

    return (
        <>
            <Box>
                <Typography variant="h6" sx={{ mb: 1 }}>
                    要確認
                </Typography>
                <Stack spacing={1.25}>
                    {items.map(item => (
                        <Card key={item.id} variant="outlined">
                            <CardContent sx={{ display: 'flex', gap: 1.5, p: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                        {item.recorded?.name ?? '番組情報が見つかりません'}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {item.mode ?? 'エンコード設定を特定できません'}
                                        {' ・ '}
                                        {item.status === 'paused' ? '一時停止中' : '要確認'}
                                    </Typography>
                                    <Alert severity={item.canRetry ? 'info' : 'warning'} sx={{ mt: 1 }}>
                                        {item.reason}
                                    </Alert>
                                    <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'flex-end' }}>
                                        {item.canRetry && (
                                            <Button startIcon={<ReplayOutlined />} disabled={retry.isPending || remove.isPending} onClick={() => retry.mutate(item.id)}>
                                                再開
                                            </Button>
                                        )}
                                        <Button
                                            color="error"
                                            startIcon={<DeleteOutlineOutlined />}
                                            disabled={retry.isPending || remove.isPending}
                                            onClick={() => setDeleteTarget(item)}
                                        >
                                            削除
                                        </Button>
                                    </Stack>
                                </Box>
                            </CardContent>
                        </Card>
                    ))}
                </Stack>
            </Box>
            <Dialog
                open={deleteTarget !== null}
                onClose={() => {
                    if (!remove.isPending) setDeleteTarget(null);
                }}
            >
                <DialogTitle>要確認タスクを削除しますか？</DialogTitle>
                <DialogContent>
                    <Typography>{deleteTarget?.recorded?.name ?? '番組情報が見つからないタスク'}をキューから削除します。</Typography>
                </DialogContent>
                <DialogActions>
                    <Button disabled={remove.isPending} onClick={() => setDeleteTarget(null)}>
                        閉じる
                    </Button>
                    <Button
                        color="error"
                        variant="contained"
                        disabled={remove.isPending || deleteTarget === null}
                        onClick={() => {
                            if (deleteTarget !== null) remove.mutate(deleteTarget.id);
                        }}
                    >
                        削除
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
