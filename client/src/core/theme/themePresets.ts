import type { PaletteOptions } from '@mui/material/styles';

export type AppThemePresetId =
    'neon-teal' | 'neon-cyan' | 'neon-blue' | 'neon-violet' | 'neon-magenta' | 'neon-pink' | 'neon-red' | 'neon-orange' | 'neon-lime' | 'custom' | 'classic';

interface AppThemeVariant {
    palette: PaletteOptions;
    headerBackground: string;
    drawerBackground: string;
}

export interface AppThemePreset {
    id: AppThemePresetId;
    label: string;
    preview: string;
    light: AppThemeVariant;
    dark: AppThemeVariant;
}

const neoLightSurface = { default: '#f4f6f8', paper: '#ffffff' } as const;
const neoDarkSurface = { default: '#101418', paper: '#191e23' } as const;

function neonPreset(id: Exclude<AppThemePresetId, 'classic'>, label: string, primary: string, secondary: string): AppThemePreset {
    return {
        id,
        label,
        preview: primary,
        light: {
            palette: { primary: { main: primary }, secondary: { main: secondary }, background: neoLightSurface },
            headerBackground: primary,
            drawerBackground: neoLightSurface.paper,
        },
        dark: {
            palette: { primary: { main: primary }, secondary: { main: secondary }, background: neoDarkSurface },
            headerBackground: neoDarkSurface.paper,
            drawerBackground: neoDarkSurface.paper,
        },
    };
}

export const appThemePresets: readonly AppThemePreset[] = [
    neonPreset('neon-teal', 'ターコイズ', '#20a89a', '#4f9de8'),
    neonPreset('neon-cyan', 'シアン', '#00a6c8', '#536dfe'),
    neonPreset('neon-blue', 'ブルー', '#267dff', '#00a8c6'),
    neonPreset('neon-violet', 'バイオレット', '#7c4dff', '#d946ef'),
    neonPreset('neon-magenta', 'マゼンタ', '#c23bb7', '#7c4dff'),
    neonPreset('neon-pink', 'ピンク', '#e83e78', '#ab47bc'),
    neonPreset('neon-red', 'レッド', '#e54861', '#ff8a65'),
    neonPreset('neon-orange', 'オレンジ', '#ef7d00', '#fbc02d'),
    neonPreset('neon-lime', 'ライム', '#76a900', '#00a896'),
    {
        id: 'classic',
        label: 'クラシック',
        preview: '#1976d2',
        light: {
            palette: {
                primary: { main: '#1976d2' },
                secondary: { main: '#424242' },
                error: { main: '#ff5252' },
                info: { main: '#2196f3' },
                success: { main: '#4caf50' },
                warning: { main: '#fb8c00' },
                background: { default: '#ffffff', paper: '#ffffff' },
                text: { primary: 'rgba(0, 0, 0, 0.87)', secondary: 'rgba(0, 0, 0, 0.60)', disabled: 'rgba(0, 0, 0, 0.38)' },
                divider: 'rgba(0, 0, 0, 0.12)',
                action: {
                    hoverOpacity: 0.04,
                    selectedOpacity: 0.08,
                    focusOpacity: 0.12,
                    activatedOpacity: 0.12,
                    disabledOpacity: 0.26,
                },
            },
            headerBackground: '#3f51b5',
            drawerBackground: '#ffffff',
        },
        dark: {
            palette: {
                primary: { main: '#2196f3' },
                secondary: { main: '#424242' },
                error: { main: '#ff5252' },
                info: { main: '#2196f3' },
                success: { main: '#4caf50' },
                warning: { main: '#fb8c00' },
                background: { default: '#121212', paper: '#1e1e1e' },
                text: { primary: '#ffffff', secondary: 'rgba(255, 255, 255, 0.70)', disabled: 'rgba(255, 255, 255, 0.50)' },
                divider: 'rgba(255, 255, 255, 0.12)',
                action: {
                    hoverOpacity: 0.08,
                    selectedOpacity: 0.16,
                    focusOpacity: 0.24,
                    activatedOpacity: 0.24,
                    disabledOpacity: 0.3,
                },
            },
            headerBackground: '#272727',
            drawerBackground: '#363636',
        },
    },
    neonPreset('custom', 'カスタム', '#20a89a', '#4f9de8'),
];

export const defaultAppThemePresetId: AppThemePresetId = 'neon-teal';
export const defaultCustomThemeColor = '#20a89a';

export function normalizeCustomThemeColor(value: unknown): string {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : defaultCustomThemeColor;
}

export function isAppThemePresetId(value: unknown): value is AppThemePresetId {
    return typeof value === 'string' && appThemePresets.some(preset => preset.id === value);
}

export function getAppThemePreset(id: AppThemePresetId): AppThemePreset {
    return appThemePresets.find(preset => preset.id === id) ?? appThemePresets[0];
}
