import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../api';
import IConfiguration from '../IConfiguration';
import IAutoEncodeSettingsModel from './IAutoEncodeSettingsModel';

export class AutoEncodeSettingsValidationError extends Error {}

@injectable()
export default class AutoEncodeSettingsModel implements IAutoEncodeSettingsModel {
    private readonly settingsPath = path.join(__dirname, '..', '..', '..', 'data', 'auto-encode-settings.json');
    private writing: Promise<void> = Promise.resolve();

    constructor(@inject('IConfiguration') private readonly configuration: IConfiguration) {}

    public async getSettings(): Promise<apid.AutoEncodeSettings> {
        let dropThreshold: number | null = null;
        try {
            const saved: unknown = JSON.parse(await fs.promises.readFile(this.settingsPath, 'utf8'));
            dropThreshold = this.validate(saved);
        } catch (err: any) {
            if (err?.code !== 'ENOENT') throw err;
        }
        return { dropThreshold, dropCheckEnabled: this.configuration.getConfig().isEnabledDropCheck === true };
    }

    public async updateSettings(option: apid.UpdateAutoEncodeSettingsOption): Promise<apid.AutoEncodeSettings> {
        const dropThreshold = this.validate(option);
        const writing = this.writing.then(async () => {
            await fs.promises.mkdir(path.dirname(this.settingsPath), { recursive: true });
            const temporary = `${this.settingsPath}.${process.pid.toString(10)}.tmp`;
            try {
                await fs.promises.writeFile(temporary, JSON.stringify({ dropThreshold }), { mode: 0o600 });
                await fs.promises.rename(temporary, this.settingsPath);
            } finally {
                await fs.promises.rm(temporary, { force: true });
            }
        });
        this.writing = writing.catch(() => {});
        await writing;
        return { dropThreshold, dropCheckEnabled: this.configuration.getConfig().isEnabledDropCheck === true };
    }

    private validate(option: unknown): number | null {
        if (typeof option !== 'object' || option === null || Array.isArray(option)) {
            throw new AutoEncodeSettingsValidationError('自動エンコード設定が不正です');
        }
        const threshold = (option as { dropThreshold?: unknown }).dropThreshold;
        if (threshold === null) return null;
        if (typeof threshold !== 'number' || !Number.isSafeInteger(threshold) || threshold < 1) {
            throw new AutoEncodeSettingsValidationError('drop数は1以上の整数で指定してください');
        }
        return threshold;
    }
}
