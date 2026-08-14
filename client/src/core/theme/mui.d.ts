import type {} from '@mui/material/styles';

declare module '@mui/material/styles' {
    interface Theme {
        appHeader: {
            background: string;
        };
    }

    interface ThemeOptions {
        appHeader?: {
            background?: string;
        };
    }
}
