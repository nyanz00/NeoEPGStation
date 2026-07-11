import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useSettings } from '../storage/settings';

export function AppThemeProvider({ children }: { children: ReactNode }): ReactNode {
    const settings = useSettings();
    const [osDark, setOsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const update = (): void => setOsDark(media.matches);
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);

    const isDark = settings.shouldUseOSColorTheme ? osDark : settings.isForceDarkTheme;
    const theme = useMemo(
        () =>
            createTheme({
                palette: {
                    mode: isDark ? 'dark' : 'light',
                    primary: { main: '#20a89a' },
                    secondary: { main: '#4f9de8' },
                    background: isDark ? { default: '#101418', paper: '#191e23' } : { default: '#f4f6f8', paper: '#ffffff' },
                },
                shape: { borderRadius: 6 },
                typography: {
                    fontFamily: 'Roboto, "Noto Sans JP", "Yu Gothic UI", sans-serif',
                    button: { textTransform: 'none' },
                },
                components: {
                    MuiButton: { defaultProps: { disableElevation: true } },
                    MuiCard: { styleOverrides: { root: { backgroundImage: 'none' } } },
                },
            }),
        [isDark],
    );

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
        </ThemeProvider>
    );
}
