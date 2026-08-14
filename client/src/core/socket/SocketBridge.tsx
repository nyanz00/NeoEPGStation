import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { withBasePath } from '../path';

interface SocketBridgeProps {
    socketIOPort: number;
    onConnectionChange: (connected: boolean) => void;
}

function socketUrl(port: number): string | undefined {
    const defaultPort = location.protocol === 'https:' ? '443' : '80';
    const currentPort = location.port.length === 0 ? defaultPort : location.port;
    if (port.toString(10) === currentPort) {
        return undefined;
    }
    const hostname = location.hostname.includes(':') ? `[${location.hostname}]` : location.hostname;
    return `${location.protocol}//${hostname}:${port}`;
}

export function SocketBridge({ socketIOPort, onConnectionChange }: SocketBridgeProps): null {
    const queryClient = useQueryClient();

    useEffect(() => {
        onConnectionChange(false);
        const options = {
            path: withBasePath('/socket.io'),
            timeout: 3_000,
        };
        const target = socketUrl(socketIOPort);
        let socket: Socket = target === undefined ? io(options) : io(target, options);

        const invalidateStatus = (): void => {
            const statusRoots = new Set([
                'onair',
                'recording',
                'recorded',
                'recorded-detail',
                'reserves',
                'reserve-counts',
                'reserve-lists',
                'rules',
                'encode',
                'storages',
                'system',
            ]);
            void queryClient.invalidateQueries({
                predicate: query => statusRoots.has(String(query.queryKey[0])),
            });
        };
        const connect = (): void => onConnectionChange(true);
        const disconnect = (): void => onConnectionChange(false);
        const connectError = (): void => onConnectionChange(false);

        const bind = (nextSocket: Socket): void => {
            nextSocket.on('connect', connect);
            nextSocket.on('disconnect', disconnect);
            nextSocket.on('connect_error', connectError);
            nextSocket.on('updateStatus', invalidateStatus);
            nextSocket.on('updateEncode', invalidateStatus);
        };

        bind(socket);
        if (target !== undefined) {
            socket.once('connect_error', () => {
                socket.close();
                onConnectionChange(false);
                socket = io(options);
                bind(socket);
            });
        }

        return () => {
            socket.removeAllListeners();
            socket.close();
        };
    }, [onConnectionChange, queryClient, socketIOPort]);

    return null;
}
