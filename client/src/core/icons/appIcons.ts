import { withBasePath } from '../path';

export type AppIconSetId = 'neo' | 'nyanz-tv' | 'original';

export interface AppIconSet {
    id: AppIconSetId;
    label: string;
    favicon: string;
    icon192: string;
    icon512: string;
    ios: string;
    original: string;
    manifest: string;
}

export const appIconSets: readonly AppIconSet[] = [
    {
        id: 'neo',
        label: 'NeoEPGStation',
        favicon: 'favicon-neo.png',
        icon192: 'icon-192-neo-center80.png',
        icon512: 'icon-512-neo-center80.png',
        ios: 'ios-neo.png',
        original: 'neo.png',
        manifest: 'manifest.json',
    },
    {
        id: 'nyanz-tv',
        label: 'nyanzTV',
        favicon: 'favicon-nyanzTV.png',
        icon192: 'icon-192-nyanzTV-center80.png',
        icon512: 'icon-512-nyanzTV-center80.png',
        ios: 'ios-nyanzTV.png',
        original: 'nyanzTV.png',
        manifest: 'manifest-nyanzTV.json',
    },
    {
        id: 'original',
        label: 'オリジナル',
        favicon: 'favicon.png',
        icon192: 'icon-192.png',
        icon512: 'icon-512.png',
        ios: 'ios.png',
        original: 'original.png',
        manifest: 'manifest-original.json',
    },
];

export function isAppIconSetId(value: unknown): value is AppIconSetId {
    return appIconSets.some(item => item.id === value);
}

export function getAppIconSet(value: unknown): AppIconSet {
    return appIconSets.find(item => item.id === value) ?? appIconSets[0];
}

export function appIconAssetUrl(filename: string): string {
    return withBasePath(`/icon/${filename}`);
}

export function applyAppIconSet(value: unknown): void {
    const iconSet = getAppIconSet(value);
    const favicon = document.querySelector<HTMLLinkElement>('#app-favicon, link[rel="icon"]');
    const appleTouchIcon = document.querySelector<HTMLLinkElement>('#app-apple-touch-icon, link[rel="apple-touch-icon"]');
    const manifest = document.querySelector<HTMLLinkElement>('#app-manifest, link[rel="manifest"]');
    if (favicon !== null) favicon.href = `${appIconAssetUrl(iconSet.favicon)}?v=2`;
    if (appleTouchIcon !== null) appleTouchIcon.href = `${appIconAssetUrl(iconSet.ios)}?v=2`;
    if (manifest !== null) manifest.href = `${withBasePath(`/${iconSet.manifest}`)}?icon-set=${iconSet.id}&v=2`;
}
