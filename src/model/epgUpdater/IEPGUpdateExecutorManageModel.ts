export default interface IEPGUpdateExecutorManageModel {
    execute(): Promise<void>;
    shutdownForUpdate(): Promise<void>;
}
