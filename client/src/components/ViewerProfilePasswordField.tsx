import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { IconButton, InputAdornment, TextField, Tooltip } from '@mui/material';
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';

interface ViewerProfilePasswordFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    error?: boolean;
    helperText?: ReactNode;
    autoFocus?: boolean;
    fullWidth?: boolean;
    size?: 'small' | 'medium';
    desktopWidth?: number;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function ViewerProfilePasswordField({
    label,
    value,
    onChange,
    error = false,
    helperText,
    autoFocus = false,
    fullWidth = false,
    size = 'medium',
    desktopWidth,
    onKeyDown,
}: ViewerProfilePasswordFieldProps): ReactNode {
    const [visible, setVisible] = useState(false);
    const inputId = useId().replace(/:/g, '');
    const supportsCssMask = typeof CSS !== 'undefined' && CSS.supports('-webkit-text-security', 'disc');

    return (
        <TextField
            autoFocus={autoFocus}
            fullWidth={fullWidth}
            size={size}
            label={label}
            type={visible || supportsCssMask ? 'text' : 'password'}
            name={`neoepgstation-no-autofill-${inputId}`}
            autoComplete="off"
            value={value}
            onChange={event => onChange(event.target.value)}
            error={error}
            helperText={helperText}
            onKeyDown={onKeyDown}
            slotProps={{
                htmlInput: {
                    inputMode: 'text',
                    lang: 'ja',
                    spellCheck: false,
                    autoCapitalize: 'none',
                    'data-1p-ignore': 'true',
                    'data-lpignore': 'true',
                    'data-form-type': 'other',
                },
                input: {
                    endAdornment: (
                        <InputAdornment position="end">
                            <Tooltip title={visible ? 'パスワードを隠す' : 'パスワードを表示'}>
                                <IconButton edge="end" aria-label={visible ? 'パスワードを隠す' : 'パスワードを表示'} onClick={() => setVisible(current => !current)}>
                                    {visible ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
                                </IconButton>
                            </Tooltip>
                        </InputAdornment>
                    ),
                },
            }}
            sx={{
                ...(desktopWidth === undefined ? {} : { width: { xs: '100%', sm: desktopWidth } }),
                '& .MuiInputBase-input': {
                    WebkitTextSecurity: !visible && supportsCssMask ? 'disc' : 'none',
                },
            }}
        />
    );
}
