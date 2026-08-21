import * as bodyParser from 'body-parser';
import cors from 'cors';
import express, { NextFunction } from 'express';
import * as openapi from 'express-openapi';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { inject, injectable } from 'inversify';
import * as yaml from 'js-yaml';
import * as log4js from 'log4js';
import { createRequire } from 'module';
import { mkdirp } from 'mkdirp';
import multer from 'multer';
import { OpenAPIV3 } from 'openapi-types';
import * as path from 'path';
import * as swaggerdist from 'swagger-ui-dist';
import urljoin from 'url-join';
import FileUtil from '../../util/FileUtil';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IServiceServer from './IServiceServer';
import ISocketIOManageModel from './socketio/ISocketIOManageModel';
import TailscaleCertificateManager, { TailscaleCertificate } from './TailscaleCertificateManager';

@injectable()
class ServiceServer implements IServiceServer {
    private log: ILogger;
    private config: IConfigFile;
    private socketIoManageModel: ISocketIOManageModel;
    private app = express();
    private apiInitialization!: Promise<unknown>;
    private tailscaleCertificateManager: TailscaleCertificateManager | null = null;
    private tailscaleHttpsServers: https.Server[] = [];

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('ISocketIOManageModel')
        socketIoManageModel: ISocketIOManageModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.socketIoManageModel = socketIoManageModel;

        this.init();
    }

    /**
     * 初期化処理
     */
    private init(): void {
        this.setLog();
        const api = this.getApiDocument(ServiceServer.API_YML);
        if (this.config.isAllowAllCORS === true) {
            this.app.use(cors());
        }
        this.setSwaggerUI();
        this.createUploadDir();
        this.apiInitialization = this.initOpenApi(api);
        this.setMime();
        this.setStaticFiles();
    }

    /**
     * log の設定
     */
    private setLog(): void {
        this.app.use(log4js.connectLogger(this.log.access, { level: 'info' }));
    }

    /**
     * api.yml の読み込み
     * @param ymlPath: api.yml のファイルパス
     * @return OpenAPIV3.Document
     */
    private getApiDocument(ymlPath: string): OpenAPIV3.Document {
        const api = <OpenAPIV3.Document>yaml.load(fs.readFileSync(ymlPath, 'utf-8'));

        // host 設定
        api.servers = this.config.apiServers.map(url => {
            return {
                url: urljoin(url, this.createUrl('/api')),
            };
        });

        // set title and version
        const pkg = <any>JSON.parse(fs.readFileSync(ServiceServer.PACKAGE_JSON, 'utf-8'));
        api.info.title = 'NeoEPGStation';
        api.info.version = pkg.version;

        return api;
    }

    /**
     * Open Api 設定
     * @param api: OpenAPIV3.Document
     */
    private initOpenApi(api: OpenAPIV3.Document): Promise<unknown> {
        return openapi.initialize({
            apiDoc: api,
            app: this.app,
            docsPath: '/docs',
            consumesMiddleware: {
                'application/json': bodyParser.json() as any,
                'text/text': bodyParser.text() as any,
                'multipart/form-data': (req, res, next) => {
                    this.uploadFile(req as any, res as any, next);
                },
            },
            errorMiddleware: (err, _req, res, _next) => {
                this.log.system.error(err);
                res.status(400);
                res.json(err);
            },
            errorTransformer: openApi => {
                this.log.system.error(<any>openApi);

                return {
                    message: (<any>openApi).message,
                };
            },
            exposeApiDocs: true,
            paths: this.getApiRoutes(ServiceServer.API_DIR),
        });
    }

    /**
     * API operation filesをURLへ変換する。
     *
     * fs-routesがglob 13と組み合わされたWindows環境では、ネストした
     * routeにOSのパス区切り文字 (`\\`) が残る。Expressへ渡す前に
     * アプリ側で列挙し、URLの区切り文字 (`/`) へ正規化する。
     */
    private getApiRoutes(apiDir: string): Array<{ path: string; module: unknown }> {
        const routes: Array<{ path: string; module: unknown }> = [];
        const loadModule = createRequire(__filename);
        const visit = (directory: string): void => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const filePath = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    visit(filePath);
                } else if (entry.isFile() && entry.name.endsWith('.js')) {
                    const relativePath = path.relative(apiDir, filePath).split(path.sep).join('/');
                    routes.push({
                        path: `/${relativePath.replace(/(?:index)?\.js$/, '')}`,
                        module: loadModule(filePath),
                    });
                }
            }
        };

        visit(apiDir);
        return routes;
    }

    /**
     * mime 設定
     */
    private setMime(): void {
        // static mime
        express.static.mime.define({ 'text/css': ['css', 'min.css'] });
        express.static.mime.define({ 'text/javascript': ['js', 'min.js'] });
        express.static.mime.define({
            'application/vnd.ms-fontobject': ['eot'],
        });
        express.static.mime.define({ 'application/font-ttf': ['ttf'] });
        express.static.mime.define({ 'application/font-woff': ['woff'] });
        express.static.mime.define({ 'application/font-woff2': ['woff2'] });
        express.static.mime.define({ 'magnus-internal/imagemap': ['map'] });
        express.static.mime.define({ 'image/png': ['png'] });
        express.static.mime.define({ 'image/jpg': ['jpg'] });
        express.static.mime.define({ 'video/mpeg': ['ts'] });
        express.static.mime.define({ 'application/octet-stream': ['m4s'] });
        express.static.mime.define({ 'video/MP2T': ['m3u8'] });
        express.static.mime.define({ 'text/plain': ['log'] });
    }

    /**
     * ファイル読み込み url 設定
     */
    private setStaticFiles(): void {
        // static files
        this.app.use(this.createUrl('/img'), express.static(path.join(__dirname, '..', '..', '..', 'img')));

        // thumbnail
        this.app.use(this.createUrl('/thumbnail'), express.static(this.config.thumbnail));

        // streamFile
        this.app.use(this.createUrl('/streamfiles'), express.static(this.config.streamFilePath));

        // client
        this.app.use(this.createUrl('/'), express.static(ServiceServer.CLIENT_DIR));
    }

    /**
     * SwaggerUI の設定
     */
    private setSwaggerUI(): void {
        if (fs.existsSync(ServiceServer.SWAGGER_UI_DIST) === false) {
            return;
        }

        // replace url
        // issue: https://github.com/swagger-api/swagger-ui/issues/5710
        const pathToSwaggerUi: string = swaggerdist.getAbsoluteFSPath();
        const indexContent = fs
            .readFileSync(path.join(pathToSwaggerUi, 'swagger-initializer.js'))
            .toString()
            .replace('https://petstore.swagger.io/v2/swagger.json', this.createUrl('/api/docs'));

        this.app.get(this.createUrl('/api-docs/swagger-initializer.js'), (_req, res) => {
            res.send(indexContent);
        });

        // api doc
        this.app.use(this.createUrl('/api-docs'), express.static(ServiceServer.SWAGGER_UI_DIST));

        // リダイレクト設定
        this.app.get(this.createUrl('/api/debug'), (_req, res) => {
            return res.redirect(this.createUrl('/api-docs/?url=' + this.createUrl('/api/docs')));
        });
    }

    /**
     * upload 用のディレクトリを生成する
     */
    private createUploadDir(): void {
        // upload dir
        try {
            fs.statSync(this.config.uploadTempDir);
        } catch (e: any) {
            this.log.system.info(`mkdirp: ${this.config.uploadTempDir}`);
            mkdirp.sync(this.config.uploadTempDir);
        }
    }

    /**
     * ファイルを upload する
     * @param req
     * @param res
     * @param next
     */
    private uploadFile(req: any, res: any, next: NextFunction): void {
        // uploade 生成
        let fileName = '';
        const storage = multer.diskStorage({
            destination: this.config.uploadTempDir,
            filename: (_req, file, cb) => {
                fileName =
                    file.fieldname +
                    '-' +
                    new Date().getTime().toString(16) +
                    Math.floor(100000 * Math.random()).toString(16);
                cb(null, fileName);
            },
        });

        multer({ storage: storage }).single('file')(req as any, res as any, async (err: any) => {
            if (err) {
                // エラー時はファイルを削除
                const filePath = path.join(this.config.uploadTempDir, fileName);
                try {
                    await FileUtil.unlink(filePath);
                    this.log.access.info(`delete upload file: ${filePath}`);
                } catch (err: any) {
                    this.log.access.error(`upload file delete error: ${filePath}`);
                    this.log.access.error(err.message);
                }
                return next(err.message);
            }

            if (typeof req.body.recordedId === 'string') {
                req.body.recordedId = parseInt(req.body.recordedId, 10);
            }

            if (typeof req.file !== 'undefined' && typeof req.file.fieldname !== 'undefined') {
                req.body.file = req.file.filename;
            }

            return next();
        });
    }

    /**
     * サブディレクトリを付加した path を返す
     * @param url: string
     */
    private createUrl(urlStr: string): string {
        return typeof this.config.subDirectory === 'undefined' ? urlStr : urljoin(this.config.subDirectory, urlStr);
    }

    /**
     * http server 起動
     */
    public async start(): Promise<void> {
        await this.apiInitialization;
        const socketioServers: http.Server[] = [];

        // http
        if (typeof this.config.port !== 'undefined') {
            const socketioPort =
                typeof this.config.socketioPort !== 'undefined' ? this.config.socketioPort : this.config.port;

            const server = this.app.listen(this.config.port);
            await this.waitForListening(server, `http server listening on ${this.config.port}`);

            // socket.io
            if (socketioPort === this.config.port) {
                socketioServers.push(server);
            } else {
                const socketIOServer = http.createServer();
                socketIOServer.listen(this.config.socketioPort);
                await this.waitForListening(socketIOServer, `http SocketIO listening on ${this.config.socketioPort}`);

                socketioServers.push(socketIOServer);
            }
        }

        // https
        if (typeof this.config.https !== 'undefined') {
            const option: https.ServerOptions = {
                key: fs.readFileSync(this.config.https.key),
                cert: fs.readFileSync(this.config.https.cert),
            };
            if (typeof this.config.https.ca !== 'undefined') {
                if (typeof this.config.https.ca === 'string') {
                    option.ca = fs.readFileSync(this.config.https.ca);
                } else {
                    option.ca = this.config.https.ca.map(f => {
                        return fs.readFileSync(f);
                    });
                }
                option.requestCert = true;
                option.rejectUnauthorized = true;
            }

            const httpsServer = https.createServer(option, this.app);
            httpsServer.listen(this.config.https.port);
            await this.waitForListening(httpsServer, `https server listening on ${this.config.https.port}`);

            // socket.io
            if (typeof this.config.https.socketioPort === 'undefined') {
                socketioServers.push(httpsServer);
            } else {
                const socketIOServer = https.createServer(option);
                socketioServers.push(socketIOServer);
                socketIOServer.listen(this.config.https.socketioPort);
                await this.waitForListening(
                    socketIOServer,
                    `https SocketIO listening on ${this.config.https.socketioPort}`,
                );
            }
        }

        // Tailscale の証明書取得には時間がかかる場合があるため、既存の
        // HTTP/HTTPS 用 Socket.IO は先に利用可能な状態にする。
        this.socketIoManageModel.initialize(socketioServers);

        if (this.config.tailscaleHttps?.enabled === true) {
            this.tailscaleCertificateManager = new TailscaleCertificateManager(
                this.config.tailscaleHttps,
                this.log,
                ServiceServer.ROOT_DIR,
            );
            try {
                const certificate = await this.tailscaleCertificateManager.initialize();
                const servers = await this.createTailscaleHttpsServers(certificate);
                this.tailscaleHttpsServers = servers.all;
                this.socketIoManageModel.initialize(servers.socketio);
            } catch (err: any) {
                this.log.system.error('Tailscale HTTPS could not be started');
                this.log.system.error(err);
                if (typeof this.config.port === 'undefined') {
                    throw err;
                }
            }

            this.tailscaleCertificateManager.start(certificate => {
                if (this.tailscaleHttpsServers.length === 0) {
                    void this.createTailscaleHttpsServers(certificate)
                        .then(servers => {
                            this.tailscaleHttpsServers = servers.all;
                            this.socketIoManageModel.initialize(servers.socketio);
                        })
                        .catch((err: any) => {
                            this.log.system.error('Tailscale HTTPS could not be started after certificate acquisition');
                            this.log.system.error(err);
                        });
                    return;
                }

                try {
                    for (const server of this.tailscaleHttpsServers) {
                        server.setSecureContext({
                            cert: certificate.cert,
                            key: certificate.key,
                        });
                    }
                    this.log.system.info(
                        `Tailscale HTTPS certificate activated for ${certificate.hostname}, valid until ${certificate.validTo.toISOString()}`,
                    );
                } catch (err: any) {
                    this.log.system.error('Failed to activate the renewed Tailscale HTTPS certificate');
                    this.log.system.error(err);
                }
            });
        }
    }

    private waitForListening(server: http.Server | https.Server, message: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const onError = (err: Error): void => {
                server.removeListener('listening', onListening);
                reject(err);
            };
            const onListening = (): void => {
                server.removeListener('error', onError);
                this.log.system.info(message);
                resolve();
            };
            server.once('error', onError);
            server.once('listening', onListening);
        });
    }

    private async createTailscaleHttpsServers(certificate: TailscaleCertificate): Promise<{
        all: https.Server[];
        socketio: https.Server[];
    }> {
        if (this.config.tailscaleHttps?.enabled !== true) {
            throw new Error('TailscaleHttpsIsNotEnabled');
        }

        const option: https.ServerOptions = {
            cert: certificate.cert,
            key: certificate.key,
        };
        const all: https.Server[] = [];
        const socketio: https.Server[] = [];
        try {
            const httpsServer = https.createServer(option, this.app);
            all.push(httpsServer);
            httpsServer.listen(this.config.tailscaleHttps.port);
            await this.waitForListening(
                httpsServer,
                `Tailscale https server listening on ${this.config.tailscaleHttps.port.toString(10)} for ${certificate.hostname}`,
            );

            if (typeof this.config.tailscaleHttps.socketioPort === 'undefined') {
                socketio.push(httpsServer);
            } else {
                const socketIOServer = https.createServer(option);
                all.push(socketIOServer);
                socketio.push(socketIOServer);
                socketIOServer.listen(this.config.tailscaleHttps.socketioPort);
                await this.waitForListening(
                    socketIOServer,
                    `Tailscale https SocketIO listening on ${this.config.tailscaleHttps.socketioPort.toString(10)}`,
                );
            }

            return { all, socketio };
        } catch (err) {
            for (const server of all) {
                try {
                    server.close();
                } catch {
                    // The server may have failed before it started listening.
                }
            }
            throw err;
        }
    }
}

namespace ServiceServer {
    export const ROOT_DIR = path.join(__dirname, '..', '..', '..');
    export const API_YML = path.join(ServiceServer.ROOT_DIR, 'api.yml');
    export const PACKAGE_JSON = path.join(ServiceServer.ROOT_DIR, 'package.json');
    export const SWAGGER_UI_DIST = path.join(ServiceServer.ROOT_DIR, 'node_modules', 'swagger-ui-dist');
    export const API_DIR = path.join(__dirname, 'api');
    export const CLIENT_DIR = path.join(ROOT_DIR, 'client', 'dist');
}

export default ServiceServer;
