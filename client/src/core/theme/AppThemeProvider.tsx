import { CssBaseline, Grow, ThemeProvider, createTheme } from '@mui/material';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useSettings } from '../storage/settings';
import { isCustomCssDisabledByUrl, useCustomCssPreview } from './customCss';
import { getAppThemePreset, normalizeCustomThemeColor } from './themePresets';
import { useThemePreview } from './themePreview';

export function AppThemeProvider({ children }: { children: ReactNode }): ReactNode {
    const settings = useSettings();
    const themePreview = useThemePreview();
    const customCssPreview = useCustomCssPreview();
    const [osDark, setOsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const update = (): void => setOsDark(media.matches);
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);

    const themeSettings = themePreview ?? settings;
    const isDark = themeSettings.shouldUseOSColorTheme ? osDark : themeSettings.isForceDarkTheme;
    const selectedPreset = getAppThemePreset(themeSettings.themeColorPreset);
    const emphasizeLightThemeEdges = !isDark && themeSettings.isEmphasizeLightThemeEdges;
    const selectedVariant = useMemo(() => {
        const base = isDark ? selectedPreset.dark : selectedPreset.light;
        if (selectedPreset.id !== 'custom') return base;
        const customColor = normalizeCustomThemeColor(themeSettings.customThemeColor);
        return {
            ...base,
            palette: {
                ...base.palette,
                primary: { main: customColor },
            },
            headerBackground: isDark ? base.headerBackground : customColor,
        };
    }, [isDark, selectedPreset, themeSettings.customThemeColor]);
    const normalDivider = selectedVariant.palette.divider ?? (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)');
    const selectedPaper = selectedVariant.palette.background?.paper ?? (isDark ? '#191e23' : '#ffffff');
    const selectedBackground = selectedVariant.palette.background?.default ?? selectedPaper;
    const resolvedBackground = isDark ? selectedBackground : emphasizeLightThemeEdges ? '#eceff1' : selectedPaper;
    const theme = useMemo(
        () =>
            createTheme({
                palette: {
                    mode: isDark ? 'dark' : 'light',
                    ...selectedVariant.palette,
                    background: {
                        ...selectedVariant.palette.background,
                        default: resolvedBackground,
                        paper: selectedPaper,
                    },
                },
                appHeader: { background: selectedVariant.headerBackground },
                shape: { borderRadius: 6 },
                typography: {
                    fontFamily: 'Roboto, "Noto Sans JP", "Yu Gothic UI", sans-serif',
                    button: { textTransform: 'none' },
                },
                components: {
                    MuiButton: { defaultProps: { disableElevation: true } },
                    MuiCard: {
                        styleOverrides: {
                            root: {
                                backgroundImage: 'none',
                                '&.MuiPaper-outlined': emphasizeLightThemeEdges
                                    ? {
                                          borderColor: 'rgba(45, 61, 74, 0.34) !important',
                                          boxShadow: '0 2px 6px rgba(31, 45, 57, 0.14) !important',
                                      }
                                    : {
                                          borderColor: `${normalDivider} !important`,
                                          boxShadow: 'none !important',
                                      },
                            },
                        },
                    },
                    MuiDivider: {
                        styleOverrides: {
                            root: {
                                borderColor: `${emphasizeLightThemeEdges ? 'rgba(45, 61, 74, 0.26)' : normalDivider} !important`,
                            },
                        },
                    },
                    MuiDrawer: {
                        styleOverrides: {
                            paper: {
                                backgroundColor: selectedVariant.drawerBackground,
                                borderRightColor: `${emphasizeLightThemeEdges ? 'rgba(45, 61, 74, 0.34)' : normalDivider} !important`,
                                boxShadow: emphasizeLightThemeEdges ? '1px 0 6px rgba(31, 45, 57, 0.12) !important' : 'none !important',
                            },
                        },
                    },
                    MuiInputBase: { defaultProps: { autoComplete: 'off' } },
                    MuiTextField: { defaultProps: { autoComplete: 'off' } },
                    MuiDialog: {
                        defaultProps: {
                            slots: { transition: Grow },
                            transitionDuration: { enter: 225, exit: 150 },
                        },
                    },
                },
            }),
        [emphasizeLightThemeEdges, isDark, normalDivider, resolvedBackground, selectedPaper, selectedVariant],
    );

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
            {(customCssPreview?.enabled ?? settings.isCustomCssEnabled) && !isCustomCssDisabledByUrl() && (
                <style data-neoepgstation-custom-css>{customCssPreview?.css ?? settings.customCss}</style>
            )}
        </ThemeProvider>
    );
}
