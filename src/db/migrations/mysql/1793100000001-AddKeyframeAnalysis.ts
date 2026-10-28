import { MigrationInterface, QueryRunner } from 'typeorm';
import { AddKeyframeAnalysis1793100000000 } from '../sqlite/1793100000000-AddKeyframeAnalysis.js';

// The schema uses portable TypeORM column/FK operations for both database drivers.
export class AddKeyframeAnalysis1793100000001 implements MigrationInterface {
    public async up(runner: QueryRunner): Promise<void> {
        await new AddKeyframeAnalysis1793100000000().up(runner);
    }
    public async down(runner: QueryRunner): Promise<void> {
        await new AddKeyframeAnalysis1793100000000().down(runner);
    }
}
