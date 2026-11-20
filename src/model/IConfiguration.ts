import IConfigFile from './IConfigFile.js';

export default interface IConfiguration {
    getConfig(): IConfigFile;
    onUpdated(callback: () => Promise<void>): void;
}
