import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { inject, injectable } from 'inversify';
import IConfiguration from './IConfiguration.js';
import IMirakurunClientModel from './IMirakurunClientModel.js';
import TunerServerAccessModel from './tuner/TunerServerAccessModel.js';

@injectable()
export default class MirakurunClientModel implements IMirakurunClientModel {
    private readonly client: TunerServerAccessModel;
    constructor(@inject('IConfiguration') configuration: IConfiguration) {
        const config = configuration.getConfig();
        const pkg = JSON.parse(
            fs.readFileSync(
                path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'),
                'utf8',
            ),
        );
        this.client = new TunerServerAccessModel(
            config.mirakurunPath,
            `NeoEPGStation/${pkg.version}`,
            config.tunerRequestTimeout ?? 30000,
        );
    }
    public getClient(): TunerServerAccessModel {
        return this.client;
    }
}
