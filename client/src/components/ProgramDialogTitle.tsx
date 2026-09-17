import { DialogTitle } from '@mui/material';
import type { ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';

const bottomPaddingProperty = '--program-dialog-title-bottom-padding';

export const programDialogTitleBottomPadding = `var(${bottomPaddingProperty}, 8px)`;

export function ProgramDialogTitle({ id, children }: { id: string; children: ReactNode }): ReactNode {
    const titleRef = useRef<HTMLHeadingElement | null>(null);

    useLayoutEffect(() => {
        const title = titleRef.current;
        if (title === null) return;

        const updateBottomPadding = (): void => {
            const style = window.getComputedStyle(title);
            const lineHeight = Number.parseFloat(style.lineHeight);
            const contentHeight = title.clientHeight - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0);
            const isSingleLine = Number.isFinite(lineHeight) && contentHeight <= lineHeight * 1.5;
            title.style.setProperty(bottomPaddingProperty, isSingleLine ? '10px' : '8px');
        };

        updateBottomPadding();
        if (typeof ResizeObserver === 'undefined') return () => title.style.removeProperty(bottomPaddingProperty);

        const observer = new ResizeObserver(updateBottomPadding);
        observer.observe(title);
        return () => {
            observer.disconnect();
            title.style.removeProperty(bottomPaddingProperty);
        };
    }, [children]);

    return (
        <DialogTitle ref={titleRef} id={id}>
            {children}
        </DialogTitle>
    );
}
