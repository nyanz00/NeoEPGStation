import type { Schedule, ScheduleChannleItem, ScheduleProgramItem } from '../../../api';
import type { GuideViewMode } from '../core/storage/settings';
import type { GuideColorSettings, GuideGenreSettings, GuideSizeValue } from '../core/storage/guide';
import { formatJstTime } from '../core/guide/time';

export type GuideReserveKind = 'normal' | 'conflict' | 'skip' | 'overlap';

export interface GuideReserveState {
    kind: GuideReserveKind;
    note?: string;
}

interface GuideProgramElement {
    element: HTMLDivElement;
    programId: number;
    genre: number | undefined;
    left: number;
    top: number;
    height: number;
    visible: boolean;
}

interface GuideViewport {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface GuideDomRendererOptions {
    root: HTMLElement;
    schedules: Schedule[];
    startAt: number;
    endAt: number;
    columnStartAts?: readonly number[];
    columnDurationMs?: number;
    size: GuideSizeValue;
    mode: GuideViewMode;
    dark: boolean;
    colors: GuideColorSettings;
    genres: GuideGenreSettings;
    reserves: ReadonlyMap<number, GuideReserveState>;
    onSelect: (program: ScheduleProgramItem, channel: ScheduleChannleItem) => void;
}

function programGenre(program: ScheduleProgramItem): number | undefined {
    return program.genre1 ?? program.genre2 ?? program.genre3;
}

function genreColor(genre: number | undefined, dark: boolean, colors: GuideColorSettings): string {
    const palette = dark ? colors.dark : colors.light;
    const index = genre !== undefined && genre >= 0 && genre < 16 ? genre : 16;
    return palette[index] ?? (dark ? '#445165' : '#ffffff');
}

function timeText(value: number): string {
    return formatJstTime(value);
}

export class GuideDomRenderer {
    private readonly options: GuideDomRendererOptions;
    private readonly items: GuideProgramElement[] = [];
    private genres: GuideGenreSettings;
    private reserves: ReadonlyMap<number, GuideReserveState>;
    private viewport: GuideViewport | null = null;
    private destroyed = false;

    constructor(options: GuideDomRendererOptions) {
        this.options = options;
        this.genres = options.genres;
        this.reserves = options.reserves;
        this.options.root.replaceChildren();
        void this.render();
    }

    public updateVisible(scrollLeft: number, scrollTop: number, viewportWidth: number, viewportHeight: number): void {
        this.viewport = {
            left: Math.max(0, scrollLeft),
            right: Math.max(0, scrollLeft + viewportWidth - this.options.size.timescaleWidth),
            top: Math.max(0, scrollTop),
            bottom: Math.max(0, scrollTop + viewportHeight - this.options.size.channelHeight),
        };
        if (this.options.mode === 'all') return;

        for (const item of this.items) {
            if (this.options.mode === 'sequential' && item.visible) continue;
            const visible = this.isVisible(item);
            if (visible === item.visible) continue;
            item.visible = visible;
            item.element.hidden = !visible;
        }
    }

    public updateGenres(genres: GuideGenreSettings): void {
        this.genres = genres;
        for (const item of this.items) {
            item.element.classList.toggle('guide-program-genre-hidden', item.genre !== undefined && genres[item.genre] === false);
        }
    }

    public updateReserves(reserves: ReadonlyMap<number, GuideReserveState>): void {
        this.reserves = reserves;
        for (const item of this.items) {
            this.applyReserveState(item.element, reserves.get(item.programId), item.height);
        }
    }

    public destroy(): void {
        this.destroyed = true;
        this.options.root.replaceChildren();
        this.items.length = 0;
    }

    private isVisible(item: GuideProgramElement): boolean {
        if (this.viewport === null) return false;
        return (
            item.left + this.options.size.channelWidth > this.viewport.left &&
            item.left < this.viewport.right &&
            item.top + item.height > this.viewport.top &&
            item.top < this.viewport.bottom
        );
    }

    private applyReserveState(element: HTMLDivElement, reserve: GuideReserveState | undefined, height: number): void {
        if (reserve === undefined) {
            delete element.dataset.reserve;
            delete element.dataset.reserveNote;
            return;
        }

        element.dataset.reserve = reserve.kind;
        if (reserve.note !== undefined && reserve.note.length > 0 && height >= 24 && this.options.size.channelWidth >= 48) {
            element.dataset.reserveNote = reserve.note;
        } else {
            delete element.dataset.reserveNote;
        }
    }

    private async render(): Promise<void> {
        let fragment = document.createDocumentFragment();
        let fragmentSize = 0;
        const { size, startAt, endAt, columnStartAts, columnDurationMs } = this.options;
        const defaultColumnDurationMs = endAt - startAt;

        for (let channelIndex = 0; channelIndex < this.options.schedules.length; channelIndex += 1) {
            const schedule = this.options.schedules[channelIndex];
            const columnStartAt = columnStartAts?.[channelIndex] ?? startAt;
            const columnEndAt = columnStartAt + (columnDurationMs ?? defaultColumnDurationMs);
            for (const program of schedule.programs) {
                if (this.destroyed) return;
                const programStart = Math.max(columnStartAt, program.startAt);
                const programEnd = Math.min(columnEndAt, program.endAt);
                if (programEnd <= programStart) continue;

                const topMinutes = programStart === columnStartAt ? 0 : Math.ceil(Math.floor((programStart - columnStartAt) / 1_000) / 60);
                const heightMinutes = Math.ceil((programEnd - programStart) / 60_000);
                const top = (topMinutes * size.timescaleHeight) / 60;
                const height = (heightMinutes * size.timescaleHeight) / 60;
                const left = channelIndex * size.channelWidth;
                const genre = programGenre(program);
                const reserve = this.reserves.get(program.id);
                const element = document.createElement('div');
                element.className = 'guide-program';
                element.style.left = `${left}px`;
                element.style.top = `${top}px`;
                element.style.width = `${size.channelWidth}px`;
                element.style.height = `${height}px`;
                element.style.fontSize = `${size.programFontSize}pt`;
                element.style.backgroundColor = genreColor(genre, this.options.dark, this.options.colors);
                element.style.color = this.options.dark ? '#fff' : '#202124';
                element.title = `${timeText(program.startAt)} ${program.name}`;
                element.tabIndex = 0;
                element.setAttribute('role', 'button');
                element.setAttribute('aria-label', element.title);
                if (this.options.dark) element.classList.add('guide-program-dark');
                if (genre !== undefined && this.genres[genre] === false) element.classList.add('guide-program-genre-hidden');
                this.applyReserveState(element, reserve, height);

                const name = document.createElement('div');
                name.className = 'guide-program-name';
                name.textContent = program.name;
                element.appendChild(name);

                const time = document.createElement('div');
                time.className = 'guide-program-time';
                time.textContent = timeText(program.startAt);
                element.appendChild(time);

                if (program.description !== undefined) {
                    const description = document.createElement('div');
                    description.className = 'guide-program-description';
                    description.textContent = program.description;
                    element.appendChild(description);
                }

                const select = (): void => this.options.onSelect(program, schedule.channel);
                element.onclick = select;
                element.onkeydown = event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    select();
                };
                const item = { element, programId: program.id, genre, left, top, height, visible: this.options.mode === 'all' };
                const visible = this.options.mode === 'all' || this.isVisible(item);
                item.visible = visible;
                element.hidden = !visible;
                fragment.appendChild(element);
                this.items.push(item);
                fragmentSize += 1;

                if (fragmentSize >= 500) {
                    if (this.destroyed) return;
                    this.options.root.appendChild(fragment);
                    fragment = document.createDocumentFragment();
                    fragmentSize = 0;
                    await new Promise<void>(resolve => window.setTimeout(resolve, 1));
                }
            }
        }

        if (!this.destroyed && fragmentSize > 0) this.options.root.appendChild(fragment);
    }
}
