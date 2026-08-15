const DPLAYER_REPOSITORY_URL = 'https://github.com/nyanz00/DPlayer';

export const DPLAYER_MOBILE_VOLUME_CONTROL_NAME = 'mobile-volume';
export const DPLAYER_VOLUME_ON_ICON =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z"/></svg>';
const DPLAYER_VOLUME_OFF_ICON =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.59 3L19 9.59 20.41 11 18 13.41 20.41 15 19 16.41 16.59 14 14.18 16.41 12.77 15l2.41-2.41L12.77 10 14.18 8.59 16.59 11 19 8.59 20.41 10z"/></svg>';

interface WebkitFullscreenElement extends HTMLElement {
    webkitRequestFullscreen?: () => Promise<void> | void;
}

function isIPad(): boolean {
    return /iPad/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export function configureDPlayerUi(container: HTMLElement): HTMLElement {
    const versionLink = Array.from(container.querySelectorAll<HTMLAnchorElement>('.dplayer-menu-item a')).find(link => link.textContent?.trim().startsWith('DPlayer v'));
    if (versionLink !== undefined) {
        versionLink.href = DPLAYER_REPOSITORY_URL;
        versionLink.rel = 'noopener noreferrer';
    }

    const infoPanelClose = container.querySelector<HTMLElement>('.dplayer-info-panel-close');
    if (infoPanelClose !== null) {
        infoPanelClose.textContent = '×';
        infoPanelClose.setAttribute('role', 'button');
        infoPanelClose.setAttribute('aria-label', '統計情報を閉じる');
        infoPanelClose.setAttribute('title', '統計情報を閉じる');
    }

    // PiP is provided by the browser integration. Defensively collapse any
    // duplicate player-side controls that an older/cached DPlayer may render.
    container.querySelectorAll<HTMLElement>('.dplayer-pip-icon').forEach(button => button.remove());

    const volume = container.querySelector<HTMLElement>('.dplayer-volume');
    if (volume !== null && container.querySelector('.neo-player-volume-percent') === null) {
        const percent = document.createElement('span');
        percent.className = 'neo-player-volume-percent';
        percent.setAttribute('aria-hidden', 'true');
        volume.insertAdjacentElement('afterend', percent);
    }
    updateDPlayerVolumePercent(container);

    // iPadOS can only put the video element itself into native fullscreen on some
    // versions. Use DPlayer's viewport-filling mode only on iPad so the custom
    // controls remain visible. iPhone keeps DPlayer's native fullscreen player.
    const fullscreenContainer = container as WebkitFullscreenElement;
    if (isIPad() && container.requestFullscreen === undefined && fullscreenContainer.webkitRequestFullscreen === undefined) {
        const browserFullscreenButton = container.querySelector<HTMLElement>('.dplayer-full-icon');
        const webFullscreenButton = container.querySelector<HTMLElement>('.dplayer-full-in-icon');
        browserFullscreenButton?.addEventListener(
            'click',
            event => {
                event.preventDefault();
                event.stopImmediatePropagation();
                webFullscreenButton?.click();
            },
            { capture: true },
        );
    }

    const controlsPortal = document.createElement('div');
    controlsPortal.className = 'neo-player-central-controls-host';
    container.append(controlsPortal);
    return controlsPortal;
}

export function updateDPlayerMobileVolumeControl(container: HTMLElement, muted: boolean): void {
    const button = container.querySelector<HTMLButtonElement>(`[data-dplayer-custom-control="${DPLAYER_MOBILE_VOLUME_CONTROL_NAME}"]`);
    const icon = button?.querySelector<HTMLElement>('.dplayer-icon-content');
    if (button === null || button === undefined || icon === null || icon === undefined) return;
    const label = muted ? 'ミュートを解除' : 'ミュート';
    icon.innerHTML = muted ? DPLAYER_VOLUME_OFF_ICON : DPLAYER_VOLUME_ON_ICON;
    button.setAttribute('aria-label', label);
    button.setAttribute('data-balloon', label);
    button.title = label;
    updateDPlayerVolumePercent(container);
}

export function updateDPlayerVolumePercent(container: HTMLElement): void {
    const video = container.querySelector<HTMLVideoElement>('video');
    const percent = container.querySelector<HTMLElement>('.neo-player-volume-percent');
    if (video === null || percent === null) return;
    percent.textContent = `${video.muted ? 0 : Math.round(video.volume * 100).toString(10)}%`;
}
