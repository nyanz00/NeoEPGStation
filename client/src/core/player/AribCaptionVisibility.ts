interface AribCaptionRenderer {
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
        if (currentPlayer !== player) return;

        const renderer = currentPlayer.plugins.aribb24Caption as AribCaptionRenderer | undefined;
        if (renderer === undefined || typeof renderer.show !== 'function') return;

        renderer.show();
    });
}
