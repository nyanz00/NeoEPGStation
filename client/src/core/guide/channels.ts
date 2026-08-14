export function guideChannelDisplayName(name: string): string {
    return name.replace(/[A-Za-z0-9]/g, character => String.fromCharCode(character.charCodeAt(0) + 0xfee0));
}
