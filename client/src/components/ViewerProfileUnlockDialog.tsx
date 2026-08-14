import LockOutlined from '@mui/icons-material/LockOutlined';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import type { ViewerProfile } from '../../../api';
import { api } from '../core/api/queries';
import { activeUserStore } from '../core/storage/activeUser';
import { viewerProfileStore, useViewerProfile } from '../core/storage/viewerProfile';
import { normalizeViewerProfilePassword, viewerProfilePasswordError } from '../core/viewerProfilePassword';
import { ViewerProfilePasswordField } from './ViewerProfilePasswordField';
import { ViewerRecoveryCodeDialog } from './ViewerRecoveryCodeDialog';

interface ViewerProfileUnlockDialogProps {
    loaded: boolean;
    profiles: ViewerProfile[];
}

export function ViewerProfileUnlockDialog({ loaded, profiles }: ViewerProfileUnlockDialogProps): ReactNode {
    const viewerProfile = useViewerProfile();
    const queryClient = useQueryClient();
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
    const profile = useMemo(() => profiles.find(item => item.id === viewerProfile.profileId), [profiles, viewerProfile.profileId]);
    const shouldOpen = loaded && profile?.lockRequired === true && viewerProfile.sessionToken === undefined;
    const passwordError = viewerProfilePasswordError(password);

    const unlock = useMutation({
        mutationFn: () => api.unlockViewerProfile(viewerProfile.profileId as number, normalizeViewerProfilePassword(password)),
        onSuccess: async session => {
            viewerProfileStore.unlock(viewerProfile.profileId as number, session.sessionToken);
            if (session.recoveryCode !== undefined) setRecoveryCode(session.recoveryCode);
            setPassword('');
            setErrorMessage(null);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['viewer-profiles'] }),
                queryClient.invalidateQueries({ queryKey: ['annict'] }),
                queryClient.invalidateQueries({ queryKey: ['twitter'] }),
            ]);
        },
        onError: error => setErrorMessage(error.message),
    });

    const cancel = (): void => {
        setPassword('');
        setErrorMessage(null);
        activeUserStore.save('master');
    };

    return (
        <>
            <Dialog open={shouldOpen} onClose={cancel} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LockOutlined />
                    アクティブユーザーの確認
                </DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        {profile?.name ?? '選択したユーザー'}
                        は外部連携パスワードで保護されています。このユーザーをアクティブユーザーとして使用するにはパスワードを入力してください。
                    </DialogContentText>
                    {errorMessage !== null && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {errorMessage}
                        </Alert>
                    )}
                    <ViewerProfilePasswordField
                        autoFocus
                        fullWidth
                        label="外部連携パスワード"
                        value={password}
                        onChange={setPassword}
                        error={password.length > 0 && passwordError !== null}
                        helperText={password.length > 0 ? passwordError : undefined}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && passwordError === null && !unlock.isPending) unlock.mutate();
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={cancel}>masterへ戻る</Button>
                    <Button variant="contained" disabled={passwordError !== null || unlock.isPending} onClick={() => unlock.mutate()}>
                        解除
                    </Button>
                </DialogActions>
            </Dialog>
            <ViewerRecoveryCodeDialog recoveryCode={recoveryCode} onClose={() => setRecoveryCode(null)} />
        </>
    );
}
