export const SERVICE_EXIT_CODE_ADDRESS_IN_USE = 78;

export type ServiceProcessMessage = { type: 'heartbeat' } | { type: 'ready' };

export const isAddressInUseError = (err: unknown): boolean => {
    let current = err;
    const visited = new Set<unknown>();

    while (typeof current === 'object' && current !== null && visited.has(current) === false) {
        visited.add(current);
        if ('code' in current && current.code === 'EADDRINUSE') return true;
        current = 'cause' in current ? current.cause : undefined;
    }

    return false;
};
