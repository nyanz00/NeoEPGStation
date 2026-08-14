import { FormControl, FormHelperText, InputLabel, MenuItem, Select } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { api } from '../core/api/queries';
import { useActiveUser, type ActiveUserId } from '../core/storage/activeUser';

interface UserSelectorProps {
    value: ActiveUserId;
    onChange: (value: ActiveUserId) => void;
    includeMaster?: boolean;
    label?: string;
    minWidth?: number;
}

export function UserSelector({ value, onChange, includeMaster = true, label = 'ユーザー', minWidth = 180 }: UserSelectorProps): ReactNode {
    const activeUser = useActiveUser();
    const users = useQuery({ queryKey: ['users'], queryFn: api.getUsers });
    const hasNoUsers = users.isSuccess && users.data.users.length === 0;

    useEffect(() => {
        if (value !== null || users.data === undefined) {
            return;
        }
        if (includeMaster && activeUser === 'master') {
            onChange('master');
            return;
        }
        const preferred = typeof activeUser === 'number' ? users.data.users.find(user => user.id === activeUser)?.id : undefined;
        onChange(preferred ?? users.data.users[0]?.id ?? (includeMaster ? 'master' : null));
    }, [activeUser, includeMaster, onChange, users.data, value]);

    return (
        <FormControl size="small" sx={{ minWidth }} error={users.isError}>
            <InputLabel>{label}</InputLabel>
            <Select
                label={label}
                value={value ?? ''}
                disabled={users.isPending || users.isError || (hasNoUsers && !includeMaster)}
                onChange={event => onChange(event.target.value as ActiveUserId)}
            >
                {includeMaster && <MenuItem value="master">master（すべて）</MenuItem>}
                {users.isPending && <MenuItem value="">読み込み中…</MenuItem>}
                {hasNoUsers && !includeMaster && <MenuItem value="">ユーザーがありません</MenuItem>}
                {users.data?.users.map(user => (
                    <MenuItem key={user.id} value={user.id}>
                        {user.name}
                    </MenuItem>
                ))}
            </Select>
            {users.isError && (
                <FormHelperText>
                    ユーザーを取得できません。{' '}
                    <button type="button" onClick={() => void users.refetch()}>
                        再試行
                    </button>
                </FormHelperText>
            )}
            {hasNoUsers && !includeMaster && <FormHelperText>通常ユーザーを作成してください</FormHelperText>}
        </FormControl>
    );
}
