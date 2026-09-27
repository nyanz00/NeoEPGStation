import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAdmin1790100000001 implements MigrationInterface {
    name = 'AddUserAdmin1790100000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('tv_user', 'isAdmin'))) {
            await queryRunner.query('ALTER TABLE `tv_user` ADD `isAdmin` tinyint NOT NULL DEFAULT 0');
        }
        const admins = await queryRunner.query('SELECT `id` FROM `tv_user` WHERE `isAdmin` = 1 LIMIT 1');
        if (admins.length === 0) {
            const users = await queryRunner.query('SELECT `id` FROM `tv_user` ORDER BY `id` ASC LIMIT 1');
            if (users.length > 0)
                await queryRunner.query('UPDATE `tv_user` SET `isAdmin` = 1 WHERE `id` = ?', [users[0].id]);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('tv_user', 'isAdmin')) {
            await queryRunner.query('ALTER TABLE `tv_user` DROP COLUMN `isAdmin`');
        }
    }
}
