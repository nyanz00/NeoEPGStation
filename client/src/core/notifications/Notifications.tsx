import { Alert, Snackbar } from '@mui/material';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

type Severity = 'success' | 'info' | 'warning' | 'error';
interface NotificationValue {
    notify: (message: string, severity?: Severity) => void;
}

const NotificationContext = createContext<NotificationValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }): ReactNode {
    const [state, setState] = useState<{ id: number; message: string; severity: Severity } | null>(null);
    const nextId = useRef(0);
    const notify = useCallback((message: string, severity: Severity = 'info') => {
        setState({ id: ++nextId.current, message, severity });
    }, []);
    const value = useMemo(() => ({ notify }), [notify]);
    const close = useCallback((id: number) => {
        setState(current => (current?.id === id ? null : current));
    }, []);

    return (
        <NotificationContext.Provider value={value}>
            {children}
            <Snackbar
                key={state?.id}
                open={state !== null}
                autoHideDuration={3_000}
                disableWindowBlurListener
                onClose={() => state !== null && close(state.id)}
                // Keep notifications above the page and drawers, but below interactive
                // modal surfaces so an overlapping Menu or Dialog remains clickable.
                sx={{ zIndex: theme => theme.zIndex.modal - 1 }}
            >
                <Alert severity={state?.severity ?? 'info'} onClose={() => state !== null && close(state.id)} variant="filled">
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
