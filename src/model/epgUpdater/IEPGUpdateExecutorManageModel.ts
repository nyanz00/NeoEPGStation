export default interface IEPGUpdateExecutorManageModel {
    execute(): Promise<void>;
    shutdown(): Promise<void>;
}
