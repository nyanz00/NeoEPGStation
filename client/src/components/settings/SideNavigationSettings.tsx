import DragIndicatorOutlined from '@mui/icons-material/DragIndicatorOutlined';
import KeyboardArrowDownOutlined from '@mui/icons-material/KeyboardArrowDownOutlined';
import KeyboardArrowUpOutlined from '@mui/icons-material/KeyboardArrowUpOutlined';
import { Box, Button, IconButton, Stack, Switch, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { type DragEvent, type ReactNode, useState } from 'react';
import { defaultSideNavigationOrder, sideNavigationLabels, type SideNavigationItemId } from '../../core/navigation';

interface SideNavigationSettingsProps {
    order: SideNavigationItemId[];
    hiddenItems: SideNavigationItemId[];
    onOrderChange: (order: SideNavigationItemId[]) => void;
    onHiddenItemsChange: (items: SideNavigationItemId[]) => void;
}

export function SideNavigationSettings({ order, hiddenItems, onOrderChange, onHiddenItemsChange }: SideNavigationSettingsProps): ReactNode {
    const [dragging, setDragging] = useState<SideNavigationItemId | null>(null);

    const move = (item: SideNavigationItemId, nextIndex: number): void => {
        const currentIndex = order.indexOf(item);
        if (currentIndex === -1 || currentIndex === nextIndex || nextIndex < 0 || nextIndex >= order.length) return;
        const next = [...order];
        next.splice(currentIndex, 1);
        next.splice(nextIndex, 0, item);
        onOrderChange(next);
    };

    const beginDrag = (event: DragEvent<HTMLElement>, item: SideNavigationItemId): void => {
        setDragging(item);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item);
    };

    const toggleVisible = (item: SideNavigationItemId, visible: boolean): void => {
        if (item === 'settings') return;
        onHiddenItemsChange(visible ? hiddenItems.filter(value => value !== item) : [...hiddenItems, item]);
    };

    return (
        <Box sx={{ mt: 1.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                ドラッグ、または上下ボタンで並び替えます。番組表の放送波別項目と予約の競合・重複は、それぞれ一つのグループとして扱います。変更はヘッダーの「保存」でこのブラウザに保存されます。
            </Typography>
            <Stack spacing={0.75}>
                {order.map((item, index) => {
                    const visible = item === 'settings' || !hiddenItems.includes(item);
                    return (
                        <Box
                            key={item}
                            onDragEnter={event => {
                                event.preventDefault();
                                if (dragging !== null && dragging !== item) move(dragging, index);
                            }}
                            onDragOver={event => event.preventDefault()}
                            sx={{
                                minHeight: 52,
                                display: 'grid',
                                gridTemplateColumns: 'auto minmax(0, 1fr) auto auto auto',
                                alignItems: 'center',
                                gap: { xs: 0.25, sm: 0.75 },
                                px: { xs: 0.75, sm: 1.25 },
                                border: '1px solid',
                                borderColor: theme =>
                                    dragging === item ? theme.palette.primary.main : alpha(theme.palette.text.primary, theme.palette.mode === 'light' ? 0.23 : 0.12),
                                borderRadius: 1,
                                bgcolor: visible ? 'background.paper' : 'action.disabledBackground',
                                opacity: visible ? 1 : 0.68,
                            }}
                        >
                            <Tooltip title="ドラッグして並び替え">
                                <Box
                                    component="span"
                                    draggable
                                    onDragStart={event => beginDrag(event, item)}
                                    onDragEnd={() => setDragging(null)}
                                    aria-label={`${sideNavigationLabels[item]}をドラッグして並び替え`}
                                    sx={{ display: 'grid', placeItems: 'center', cursor: 'grab', color: 'text.secondary', touchAction: 'none' }}
                                >
                                    <DragIndicatorOutlined />
                                </Box>
                            </Tooltip>
                            <Box sx={{ minWidth: 0 }}>
                                <Typography noWrap sx={{ fontWeight: 600 }}>
                                    {sideNavigationLabels[item]}
                                </Typography>
                                {item === 'settings' && (
                                    <Typography variant="caption" color="text.secondary">
                                        常に表示
                                    </Typography>
                                )}
                            </Box>
                            <Tooltip title="上へ移動">
                                <span>
                                    <IconButton size="small" disabled={index === 0} aria-label={`${sideNavigationLabels[item]}を上へ移動`} onClick={() => move(item, index - 1)}>
                                        <KeyboardArrowUpOutlined />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title="下へ移動">
                                <span>
                                    <IconButton
                                        size="small"
                                        disabled={index === order.length - 1}
                                        aria-label={`${sideNavigationLabels[item]}を下へ移動`}
                                        onClick={() => move(item, index + 1)}
                                    >
                                        <KeyboardArrowDownOutlined />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Switch
                                size="small"
                                checked={visible}
                                disabled={item === 'settings'}
                                onChange={event => toggleVisible(item, event.target.checked)}
                                slotProps={{ input: { 'aria-label': `${sideNavigationLabels[item]}を表示` } }}
                            />
                        </Box>
                    );
                })}
            </Stack>
            <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1.5 }}>
                <Button
                    color="inherit"
                    onClick={() => {
                        onOrderChange([...defaultSideNavigationOrder]);
                        onHiddenItemsChange([]);
                    }}
                >
                    初期状態に戻す
                </Button>
            </Stack>
        </Box>
    );
}
