import { Modal, type ModalProps, styled } from '@mui/material';
import { useForkRef } from '@mui/material/utils';
import { forwardRef, type HTMLAttributes, useLayoutEffect, useRef } from 'react';
import { acquireScrollLock } from '../core/scrollLock';

declare module '@mui/material/Modal' {
    interface ModalComponentsPropsOverrides {
        scrollLocked?: boolean;
    }
}

const ScrollLockRoot = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { scrollLocked?: boolean }>(function ScrollLockRoot({ scrollLocked, ...props }, forwardedRef) {
    const root = useRef<HTMLDivElement>(null);
    const ref = useForkRef(root, forwardedRef);
    useLayoutEffect(() => {
        if (scrollLocked && root.current) return acquireScrollLock(root.current.ownerDocument);
    }, [scrollLocked]);
    return <div {...props} ref={ref} />;
});

/** MUI still manages focus, portals and transitions; only its width-changing lock is replaced. */
export const ScrollLockModal = forwardRef<HTMLDivElement, ModalProps>(function ScrollLockModal({ disableScrollLock = false, slotProps, children, ...props }, ref) {
    const hasTransition = 'in' in (children.props as object);
    return (
        <Modal
            {...props}
            ref={ref}
            disableScrollLock
            component={ScrollLockRoot}
            slotProps={{
                ...slotProps,
                root: state => ({
                    ...(typeof slotProps?.root === 'function' ? slotProps.root(state) : slotProps?.root),
                    // Keep the lock through the exit animation, including keepMounted overlays.
                    scrollLocked: !disableScrollLock && (state.open || (hasTransition && !state.exited)),
                }),
            }}
        >
            {children}
        </Modal>
    );
});

// Preserve the original MUI root styling when replacing each component's Modal slot.
export const ScrollLockDialogRoot = styled(ScrollLockModal, { name: 'MuiDialog', slot: 'Root' })({
    '@media print': { position: 'absolute !important' },
});
export const ScrollLockPopoverRoot = styled(ScrollLockModal, { name: 'MuiPopover', slot: 'Root' })({});
export const ScrollLockDrawerRoot = styled(ScrollLockModal, { name: 'MuiDrawer', slot: 'Root' })(({ theme }) => ({
    zIndex: theme.zIndex.drawer,
}));
