import { DialogTitle } from '@mui/material';
import type { ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';

const bottomPaddingProperty = '--program-dialog-title-bottom-padding';
const closeTopProperty = '--program-dialog-close-top';

export const programDialogTitleBottomPadding = `var(${bottomPaddingProperty}, 8px)`;
export const programDialogCloseTop = `var(${closeTopProperty}, 9px)`;

export function ProgramDialogTitle({ id, children }: { id: string; children: ReactNode }): ReactNode {
    const titleRef = useRef<HTMLHeadingElement | null>(null);

    useLayoutEffect(() => {
        const title = titleRef.current;
        if (title === null) return;
        const paper = title.closest<HTMLElement>('.MuiDialog-paper');

        const updateLayout = (): void => {
            const style = window.getComputedStyle(title);
            const lineHeight = Number.parseFloat(style.lineHeight);
            const contentHeight = title.clientHeight - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0);
            const isSingleLine = Number.isFinite(lineHeight) && contentHeight <= lineHeight * 1.5;
            title.style.setProperty(bottomPaddingProperty, isSingleLine ? '12px' : '8px');
            paper?.style.setProperty(closeTopProperty, isSingleLine ? '9px' : '11px');
        };

        const resetLayout = (): void => {
            title.style.removeProperty(bottomPaddingProperty);
            paper?.style.removeProperty(closeTopProperty);
        };

        updateLayout();
        if (typeof ResizeObserver === 'undefined') return resetLayout;

        const observer = new ResizeObserver(updateLayout);
        observer.observe(title);
        return () => {
            observer.disconnect();
            resetLayout();
        };
    }, [children]);

    return (
        <DialogTitle ref={titleRef} id={id}>
            {children}
        </DialogTitle>
    );
}
