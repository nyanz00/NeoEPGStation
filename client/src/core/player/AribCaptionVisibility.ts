interface AribCaptionRenderer {
    hide: () => void;
    show: () => void;
}

interface AribCaptionPlayer {
    plugins: Record<string, unknown>;
    on: (name: string, callback: () => void) => void;
}

/** Ask aribb24.js to render its active caption again after DPlayer shows subtitles. */
export function bindAribCaptionVisibility(player: AribCaptionPlayer, getCurrentPlayer: () => AribCaptionPlayer | null): void {
    if (player.plugins.aribb24Caption === undefined || player.plugins.aribb24Caption === null) return;

    player.on('subtitle_show', () => {
        const currentPlayer = getCurrentPlayer();
        if (currentPlayer === null) return;

        const renderer = currentPlayer.plugins.aribb24Caption as AribCaptionRenderer | undefined;
        if (renderer === undefined || typeof renderer.hide !== 'function' || typeof renderer.show !== 'function') return;

        renderer.hide();
        renderer.show();

        // Compatibility target: client/package.json pins DPlayer at
        // e15270db379a885890e41d06eca215bdfe1aa785, which resolves aribb24.js 1.11.5.
        // That renderer keeps b24Track private and show() does not redraw an active cue.
        // Dispatching cuechange reuses its existing handler.
        const track = (renderer as unknown as { b24Track?: EventTarget | null }).b24Track;
        if (track !== undefined && track !== null && typeof track.dispatchEvent === 'function') {
            track.dispatchEvent(new Event('cuechange'));
        }
    });
}
