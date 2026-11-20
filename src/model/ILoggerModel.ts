import ILogger from './ILogger.js';

export default interface ILoggerModel {
    initialize(filePath?: string): void;
    getLogger(): ILogger;
}
