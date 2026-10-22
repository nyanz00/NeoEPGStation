import { ChildProcess } from 'child_process';
import { AddEncodeOption } from '../service/encode/IEncoderModel';

export default interface IIPCServer {
    register(child: ChildProcess): void;
    getRecordedUsePeer(child: ChildProcess): string | undefined;
    notifyClient(recordedId?: number): void;
    setEncode(addOption: AddEncodeOption): Promise<void>;
}
