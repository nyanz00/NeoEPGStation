import AccessTimeOutlined from '@mui/icons-material/AccessTimeOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelItem, ReserveItem } from '../../../api';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import { withBasePath } from '../core/path';
import { formatProgramDate, formatProgramTime, programDuration } from '../core/program';
import { programDialogClose, programDialogPaper } from './programDialogStyles';

function reserveLabel(item: ReserveItem): string {
    if (item.isConflict) return '競合';
    if (item.isSkip) return '除外';
    if (item.isOverlap) return '重複';
    return '予約';
}

function removeLabel(item: ReserveItem): string {
    if (item.isSkip || item.isOverlap) return '解除';
    return item.ruleId === undefined ? '削除' : '除外';
}

export function ReserveProgramDialog({
    item,
    channel,
    onClose,
    onChanged,
}: {
    item: ReserveItem | null;
    channel?: ChannelItem;
    onClose: () => void;
    onChanged?: () => void;
}): ReactNode {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const users = useQuery({ queryKey: ['users'], queryFn: api.getUsers, enabled: item !== null });
    const userName = users.data?.users.find(user => user.id === item?.userId)?.name;
    const remove = useMutation({
        mutationFn: async (target: ReserveItem) => {
            if (target.isSkip) await api.removeReserveSkip(target.id);
            else if (target.isOverlap) await api.removeReserveOverlap(target.id);
            else await api.cancelReserve(target.id);
            return target;
        },
        onSuccess: async target => {
            notify(target.isSkip ? '除外から予約に戻しました' : target.isOverlap ? '重複状態を解除して予約に戻しました' : '予約をキャンセルしました', 'success');
            onClose();
            onChanged?.();
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
                queryClient.invalidateQueries({ queryKey: ['reserves'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-counts'] }),
            ]);
        },
        onError: error => notify(`予約の変更に失敗しました: ${error.message}`, 'error'),
    });

    const closeAndNavigate = (path: string): void => {
        onClose();
        void navigate(path);
    };

    return (
        <Dialog
            open={item !== null}
            onClose={onClose}
            fullWidth
            maxWidth="md"
            disableScrollLock
            aria-labelledby="reserve-program-title"
            slotProps={{
                paper: {
                    sx: theme => ({
                        ...programDialogPaper(theme),
                        maxWidth: 720,
                        maxHeight: 'min(94dvh, 880px)',
                        '& .MuiDialogTitle-root': { ...programDialogPaper(theme)['& .MuiDialogTitle-root'], py: 1.5 },
                    }),
                },
            }}
        >
            {item !== null && (
                <>
                    <DialogTitle id="reserve-program-title">{item.name}</DialogTitle>
                    <IconButton aria-label="閉じる" onClick={onClose} sx={programDialogClose}>
                        <CloseOutlined />
                    </IconButton>
                    <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                        <Stack
                            direction="row"
                            spacing={1.5}
                            useFlexGap
                            sx={{ alignItems: 'center', flexWrap: 'wrap', px: { xs: 2, sm: 3 }, py: 1, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}
                        >
                            {channel?.hasLogoData && (
                                <Box component="img" src={withBasePath(`/api/channels/${channel.id}/logo`)} alt="" sx={{ width: 48, height: 32, objectFit: 'contain' }} />
                            )}
                            <Typography sx={{ fontWeight: 600 }}>{channel?.name ?? item.channelId}</Typography>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                <AccessTimeOutlined fontSize="small" color="action" />
                                <Typography variant="body2">
                                    {formatProgramDate(item.startAt)} – {formatProgramTime(item.endAt)}
                                </Typography>
                            </Stack>
                            <Chip size="small" variant="outlined" label={`${programDuration(item)}分`} />
                            {item.name.includes('[字]') && <Chip size="small" variant="outlined" label="字幕" />}
                            {item.name.includes('[解]') && <Chip size="small" variant="outlined" label="解説" />}
                        </Stack>
                        <Stack
                            spacing={2}
                            sx={{
                                px: { xs: 2, sm: 3 },
                                py: 1.5,
                                flex: '1 1 auto',
                                minHeight: 0,
                                overflowY: 'auto',
                                overflowWrap: 'anywhere',
                                '& .MuiTypography-root': { lineHeight: 1.8 },
                            }}
                        >
                            {item.description !== undefined && <Typography>{item.description}</Typography>}
                            {item.extended !== undefined && (
                                <Box sx={{ whiteSpace: 'pre-wrap' }}>
                                    {item.extended.split(/(^[◇◆].+$)/m).map((part, index) => (
                                        <Typography key={index} sx={{ fontWeight: /^[◇◆]/.test(part) ? 600 : 400, mt: /^[◇◆]/.test(part) ? 1 : 0 }}>
                                            {part.trim()}
                                        </Typography>
                                    ))}
                                </Box>
                            )}
                        </Stack>
                        <Stack
                            direction="row"
                            spacing={1}
                            useFlexGap
                            sx={{ flexWrap: 'wrap', px: { xs: 2, sm: 3 }, py: 1, flex: '0 0 auto', borderTop: 1, borderColor: 'divider', bgcolor: 'action.hover' }}
                        >
                            <Chip color={item.isConflict ? 'error' : 'primary'} label={reserveLabel(item)} />
                            <Chip
                                variant="outlined"
                                label={
                                    users.isError
                                        ? '予約ユーザー取得失敗'
                                        : users.isPending
                                          ? 'ユーザー読込中…'
                                          : (userName ?? (item.userId === undefined ? 'ユーザー未指定' : `ユーザーID: ${item.userId}`))
                                }
                            />
                        </Stack>
                    </DialogContent>
                    <DialogActions>
                        {item.ruleId !== undefined && (
                            <Button sx={{ mr: 'auto' }} startIcon={<SearchOutlined />} onClick={() => closeAndNavigate(`/recorded?ruleId=${item.ruleId!.toString(10)}`)}>
                                録画済み検索
                            </Button>
                        )}
                        <Button color="inherit" onClick={onClose}>
                            閉じる
                        </Button>
                        {item.ruleId === undefined ? (
                            <Button color="inherit" startIcon={<DescriptionOutlined />} onClick={() => closeAndNavigate(`/reserves/manual?reserveId=${item.id.toString(10)}`)}>
                                詳細
                            </Button>
                        ) : (
                            <Button color="inherit" startIcon={<EditOutlined />} onClick={() => closeAndNavigate(`/search?ruleId=${item.ruleId!.toString(10)}`)}>
                                編集
                            </Button>
                        )}
                        {!item.isConflict && (
                            <Button color="error" disabled={remove.isPending} onClick={() => remove.mutate(item)}>
                                {removeLabel(item)}
                            </Button>
                        )}
                    </DialogActions>
                </>
            )}
        </Dialog>
    );
}
