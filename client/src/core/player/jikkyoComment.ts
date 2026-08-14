export type JikkyoCommentPosition = 'top' | 'right' | 'bottom';
export type JikkyoCommentSize = 'big' | 'medium' | 'small';

export interface JikkyoComment {
    id: number;
    text: string;
    color: string;
    position: JikkyoCommentPosition;
    size: JikkyoCommentSize;
    userId: string;
    postedAt: number;
    vpos: number | null;
}

const colorCodes: Record<string, string> = {
    white: '#FFEAEA',
    red: '#F02840',
    pink: '#FD7E80',
    orange: '#FDA708',
    yellow: '#FFE133',
    green: '#64DD17',
    cyan: '#00D4F5',
    blue: '#4763FF',
    purple: '#D500F9',
    black: '#1E1310',
    white2: '#CCCC99',
    niconicowhite: '#CCCC99',
    red2: '#CC0033',
    truered: '#CC0033',
    pink2: '#FF33CC',
    orange2: '#FF6600',
    passionorange: '#FF6600',
    yellow2: '#999900',
    madyellow: '#999900',
    green2: '#00CC66',
    elementalgreen: '#00CC66',
    cyan2: '#00CCCC',
    blue2: '#3399FF',
    marineblue: '#3399FF',
    purple2: '#6633CC',
    nobleviolet: '#6633CC',
    black2: '#666666',
};

export function parseJikkyoCommentCommand(mail: string | null | undefined): {
    color: string;
    position: JikkyoCommentPosition;
    size: JikkyoCommentSize;
} {
    let color = '#FFEAEA';
    let position: JikkyoCommentPosition = 'right';
    let size: JikkyoCommentSize = 'medium';

    for (const command of (mail ?? '').split(/\s+/)) {
        if (/^#[0-9a-f]{6}$/i.test(command)) color = command;
        else if (colorCodes[command] !== undefined) color = colorCodes[command];
        else if (command === 'ue') position = 'top';
        else if (command === 'shita') position = 'bottom';
        else if (command === 'naka') position = 'right';
        else if (command === 'big' || command === 'medium' || command === 'small') size = command;
    }

    return { color, position, size };
}
