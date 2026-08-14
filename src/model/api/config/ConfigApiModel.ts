import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import WatchStreamProfileUtil from '../../service/stream/WatchStreamProfileUtil';
import IConfigApiModel from './IConfigApiModel';

@injectable()
export default class ConfigApiModel implements IConfigApiModel {
    private configuration: IConfiguration;
    private ipc: IIPCClient;

    constructor(@inject('IConfiguration') configuration: IConfiguration, @inject('IIPCClient') ipc: IIPCClient) {
        this.configuration = configuration;
        this.ipc = ipc;
    }

    /**
     * コンフィグ設定を返す
     * @param isSecure: boolean https アクセスか?
     */
    public async getConfig(isSecure: boolean): Promise<apid.Config> {
        const config = this.configuration.getConfig();

        const result: apid.Config = <any>{};

        // socket.io ポート設定
        if (typeof config.clientSocketioPort !== 'undefined') {
            result.socketIOPort = config.clientSocketioPort;
        } else if (isSecure === true) {
            // https
            if (config.tailscaleHttps?.enabled === true) {
                result.socketIOPort =
                    typeof config.tailscaleHttps.socketioPort === 'undefined'
                        ? config.tailscaleHttps.port
                        : config.tailscaleHttps.socketioPort;
            } else if (typeof config.https !== 'undefined') {
                result.socketIOPort =
                    typeof config.https.socketioPort === 'undefined' ? config.https.port : config.https.socketioPort;
            } else {
                throw new Error('httpsConfigError');
            }
        } else {
            // http
            if (typeof config.port === 'undefined') {
                throw new Error('httpConfigError');
            }

            result.socketIOPort = typeof config.socketioPort === 'undefined' ? config.port : config.socketioPort;
        }

        result.recorded = config.recorded.map(r => {
            return r.name;
        });

        result.encode = config.encode.map(e => {
            return e.name;
        });

        result.urlscheme = {
            m2ts: {
                ios: config.urlscheme.m2ts.ios,
                android: config.urlscheme.m2ts.android,
                mac: config.urlscheme.m2ts.mac,
                win: config.urlscheme.m2ts.win,
            },
            video: {
                ios: config.urlscheme.video.ios,
                android: config.urlscheme.video.android,
                mac: config.urlscheme.video.mac,
                win: config.urlscheme.video.win,
            },
            download: {
                ios: config.urlscheme.download.ios,
                android: config.urlscheme.download.android,
                mac: config.urlscheme.download.mac,
                win: config.urlscheme.download.win,
            },
        };

        result.broadcast = await this.ipc.reserveation.getBroadcastStatus();
        result.developerMode = config.developerMode === true;
        result.isEnableTSLiveStream = false;
        result.isEnableTSRecordedStream = false;
        result.isEnableEncodedRecordedStream = false;

        if (typeof config.stream !== 'undefined') {
            result.streamConfig = {};

            // live stream
            if (typeof config.stream.live !== 'undefined') {
                result.streamConfig.live = {};
                if (typeof config.stream.live.ts !== 'undefined') {
                    result.isEnableTSLiveStream = true;
                    result.streamConfig.live.ts = {};

                    if (typeof config.stream.live.ts.m2ts !== 'undefined') {
                        result.streamConfig.live.ts.m2ts = config.stream.live.ts.m2ts.map(c => {
                            return {
                                name: c.name,
                                isUnconverted: typeof c.cmd === 'undefined',
                            };
                        });
                    }
                    if (typeof config.stream.live.ts.m2tsll !== 'undefined') {
                        result.streamConfig.live.ts.m2tsll = config.stream.live.ts.m2tsll.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.live.ts.webm !== 'undefined') {
                        result.streamConfig.live.ts.webm = config.stream.live.ts.webm.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.live.ts.mp4 !== 'undefined') {
                        result.streamConfig.live.ts.mp4 = config.stream.live.ts.mp4.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.live.ts.hls !== 'undefined') {
                        result.streamConfig.live.ts.hls = config.stream.live.ts.hls.map(c => {
                            return c.name;
                        });
                    }
                }
            }

            // recorded stream
            if (typeof config.stream.recorded !== 'undefined') {
                result.streamConfig.recorded = {};
                // ts
                if (typeof config.stream.recorded.ts !== 'undefined') {
                    result.streamConfig.recorded.ts = {};
                    result.isEnableTSRecordedStream = true;
                    if (typeof config.stream.recorded.ts.webm !== 'undefined') {
                        result.streamConfig.recorded.ts.webm = config.stream.recorded.ts.webm.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.ts.mp4 !== 'undefined') {
                        result.streamConfig.recorded.ts.mp4 = config.stream.recorded.ts.mp4.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.ts.hls !== 'undefined') {
                        result.streamConfig.recorded.ts.hls = config.stream.recorded.ts.hls.map(c => {
                            return c.name;
                        });
                    }
                }

                // encoded
                if (typeof config.stream.recorded.encoded !== 'undefined') {
                    result.streamConfig.recorded.encoded = {};
                    result.isEnableEncodedRecordedStream = true;
                    if (typeof config.stream.recorded.encoded.webm !== 'undefined') {
                        result.streamConfig.recorded.encoded.webm = config.stream.recorded.encoded.webm.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.encoded.mp4 !== 'undefined') {
                        result.streamConfig.recorded.encoded.mp4 = config.stream.recorded.encoded.mp4.map(c => {
                            return c.name;
                        });
                    }
                    if (typeof config.stream.recorded.encoded.hls !== 'undefined') {
                        result.streamConfig.recorded.encoded.hls = config.stream.recorded.encoded.hls.map(c => {
                            return c.name;
                        });
                    }
                }
            }
        }

        if (WatchStreamProfileUtil.isEnabled(config) === true) {
            result.isEnableTSLiveStream = true;
            if (typeof result.streamConfig === 'undefined') {
                result.streamConfig = {};
            }
            if (typeof result.streamConfig.live === 'undefined') {
                result.streamConfig.live = {};
            }
            if (typeof result.streamConfig.live.ts === 'undefined') {
                result.streamConfig.live.ts = {};
            }
            result.streamConfig.live.ts.m2ts = WatchStreamProfileUtil.getLiveDisplayQualityNames(config).map(name => {
                return {
                    name: name,
                    isUnconverted: false,
                };
            });
            result.streamConfig.live.ts.m2tsll = WatchStreamProfileUtil.getLiveDisplayQualityNames(config);
            if (typeof result.streamConfig.recorded === 'undefined') {
                result.streamConfig.recorded = {};
            }
            if (typeof result.streamConfig.recorded.ts === 'undefined') {
                result.streamConfig.recorded.ts = {};
            }
            result.isEnableTSRecordedStream = true;
            result.streamConfig.recorded.ts.hls = WatchStreamProfileUtil.getRecordedDisplayQualityNames(config);
            result.streamConfig.recorded.ts.m2tsll = WatchStreamProfileUtil.getRecordedDisplayQualityNames(config);
            if (typeof result.streamConfig.recorded.encoded === 'undefined') {
                result.streamConfig.recorded.encoded = {};
            }
            result.isEnableEncodedRecordedStream = true;
            result.streamConfig.recorded.encoded.hls = WatchStreamProfileUtil.getRecordedDisplayQualityNames(config);
            result.watchConfig = {
                enabled: true,
                encoder: config.watch?.encoder ?? 'FFmpeg',
                availableEncoders: WatchStreamProfileUtil.getAvailableEncoders(config),
                defaultLiveQuality: config.watch?.defaultLiveQuality,
                defaultRecordedQuality: config.watch?.defaultRecordedQuality,
                liveQualities: WatchStreamProfileUtil.getLiveDisplayQualityNames(config),
                recordedQualities: WatchStreamProfileUtil.getRecordedQualityNames(config),
                hevc10bit: config.watch?.hevc10bit === true,
                fps24: config.watch?.fps24 === true,
            };
        }

        if (typeof config.kodiHosts !== 'undefined') {
            result.kodiHosts = config.kodiHosts.map(k => {
                return k.name;
            });
        }

        return result;
    }
}
