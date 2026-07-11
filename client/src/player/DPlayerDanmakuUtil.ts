interface DPlayerDanmaku {
    resize?: () => void;
}

interface DPlayerWithDanmaku {
    danmaku?: DPlayerDanmaku;
}

export default class DPlayerDanmakuUtil {
    public static stabilizeResize(player: DPlayerWithDanmaku, container: HTMLElement): void {
        const danmaku = player.danmaku;
        if (typeof danmaku?.resize !== 'function') {
            return;
        }

        const originalResize = danmaku.resize.bind(danmaku);
        let lastWidth = container.offsetWidth;
        danmaku.resize = (): void => {
            const width = container.offsetWidth;
            if (Math.abs(width - lastWidth) < 0.5) {
                return;
            }

            lastWidth = width;
            originalResize();
        };
    }

    public static setFontSize(container: HTMLElement, baseFontSize: number): void {
        const danmaku = container.querySelector<HTMLElement>('.dplayer-danmaku');
        if (danmaku === null) {
            return;
        }

        const ratio = Math.min(1, (danmaku.offsetWidth / 1024) * 1.25);
        const fontSize = `${(baseFontSize * ratio).toString()}px`;
        if (danmaku.style.getPropertyValue('--dplayer-danmaku-font-size') !== fontSize) {
            danmaku.style.setProperty('--dplayer-danmaku-font-size', fontSize);
        }
    }
}
