import { type MouseEvent, type PointerEvent, useCallback, useRef } from 'react';

interface TouchPlayerControlHandlers {
    onPointerDownCapture: (event: PointerEvent<HTMLElement>) => void;
    onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

function isPlayerBackground(target: EventTarget | null): boolean {
    if (!(target instanceof Element) || target.closest('.dplayer') === null) return false;
    return target.closest('button, a, input, textarea, select, [role="button"], .dplayer-controller') === null;
}

/**
 * A touch that reveals hidden controls must not activate a control that appears
 * underneath the finger before the browser dispatches the following click.
 */
export function useTouchPlayerControls(controlsVisible: boolean, showControls: () => void, hideControls: () => void, activateAudio: () => void): TouchPlayerControlHandlers {
    const suppressNextClick = useRef(false);
    const controlsVisibleRef = useRef(controlsVisible);
    controlsVisibleRef.current = controlsVisible;

    const onPointerDownCapture = useCallback(
        (event: PointerEvent<HTMLElement>): void => {
            if (event.pointerType === 'touch') activateAudio();
            const isTouchBackground = event.pointerType === 'touch' && isPlayerBackground(event.target);
            suppressNextClick.current = isTouchBackground;
            if (!isTouchBackground) {
                showControls();
                return;
            }
            if (controlsVisibleRef.current) hideControls();
            else showControls();
        },
        [activateAudio, hideControls, showControls],
    );

    const onClickCapture = useCallback((event: MouseEvent<HTMLElement>): void => {
        if (!suppressNextClick.current) return;
        suppressNextClick.current = false;
        event.preventDefault();
        event.stopPropagation();
    }, []);

    return { onPointerDownCapture, onClickCapture };
}
