import { ChildProcess } from 'child_process';
import { AddEncodeOption } from '../service/encode/IEncoderModel';

export default interface IIPCServer {
    register(child: ChildProcess): void;
    notifyClient(): void;
    setEncode(addOption: AddEncodeOption): void;
}
