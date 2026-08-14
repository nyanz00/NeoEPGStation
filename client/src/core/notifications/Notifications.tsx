import { Alert, Snackbar } from '@mui/material';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

type Severity = 'success' | 'info' | 'warning' | 'error';
interface NotificationValue {
    notify: (message: string, severity?: Severity) => void;
}

const NotificationContext = createContext<NotificationValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }): ReactNode {
    const [state, setState] = useState<{ message: string; severity: Severity } | null>(null);
    const notify = useCallback((message: string, severity: Severity = 'info') => setState({ message, severity }), []);
    const value = useMemo(() => ({ notify }), [notify]);

    return (
        <NotificationContext.Provider value={value}>
            {children}
            <Snackbar open={state !== null} autoHideDuration={3_000} onClose={() => setState(null)}>
                <Alert severity={state?.severity ?? 'info'} onClose={() => setState(null)} variant="filled">
                    {state?.message}
                </Alert>
            </Snackbar>
        </NotificationContext.Provider>
    );
}

export function useNotifications(): NotificationValue {
    const value = useContext(NotificationContext);
    if (value === null) {
        throw new Error('NotificationProvider is missing');
    }
    return value;
}
