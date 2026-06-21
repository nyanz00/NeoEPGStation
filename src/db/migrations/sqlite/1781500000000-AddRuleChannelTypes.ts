import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRuleChannelTypes1781500000000 implements MigrationInterface {
    name = 'AddRuleChannelTypes1781500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rule" ADD "channelTypes" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "rule" DROP COLUMN "channelTypes"`);
    }
}
