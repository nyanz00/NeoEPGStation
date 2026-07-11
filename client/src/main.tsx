import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { NotificationProvider } from './core/notifications/Notifications';
import { AppThemeProvider } from './core/theme/AppThemeProvider';
import './styles.css';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});

const root = document.getElementById('root');
if (root === null) {
    throw new Error('Root element was not found');
}

createRoot(root).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <AppThemeProvider>
                <NotificationProvider>
                    <App />
                </NotificationProvider>
            </AppThemeProvider>
        </QueryClientProvider>
    </StrictMode>,
);
