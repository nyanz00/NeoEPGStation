export default interface IEncodeFileManageModel {
    getFilePath(outputDirPath: string, inputFilePath: string, suffix: string): Promise<string>;
    reserveFilePath(filePath: string): void;
    release(filePath: string): void;
}
