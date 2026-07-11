export function getBasePath(): string {
    const pathname = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
    return pathname === '/' ? '' : pathname;
}

export function withBasePath(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${getBasePath()}${normalized}`;
}
