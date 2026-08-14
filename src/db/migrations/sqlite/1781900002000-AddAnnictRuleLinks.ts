import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnictRuleLinks1781900002000 implements MigrationInterface {
    name = 'AddAnnictRuleLinks1781900002000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('annict_rule_link')) return;
        await queryRunner.query(
            [
                'CREATE TABLE "annict_rule_link" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,',
                '"ruleId" integer NOT NULL, "annictId" integer NOT NULL, "viewerProfileId" integer,',
                '"source" text NOT NULL DEFAULT (\'anime\'), "createdAt" bigint NOT NULL, "updatedAt" bigint NOT NULL)',
            ].join(' '),
        );
        await queryRunner.query('CREATE UNIQUE INDEX "IDX_annict_rule_link_rule" ON "annict_rule_link" ("ruleId")');
        await queryRunner.query(
            'CREATE INDEX "IDX_annict_rule_link_work_profile" ON "annict_rule_link" ("annictId", "viewerProfileId")',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('annict_rule_link')) {
            await queryRunner.query('DROP TABLE "annict_rule_link"');
        }
    }
}
