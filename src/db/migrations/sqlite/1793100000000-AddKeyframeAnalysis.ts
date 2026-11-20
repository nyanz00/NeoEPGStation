import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

export class AddKeyframeAnalysis1793100000000 implements MigrationInterface {
    public async up(runner: QueryRunner): Promise<void> {
        if (!(await runner.hasColumn('video_file', 'analysisVersion'))) {
            await runner.addColumn(
                'video_file',
                new TableColumn({ name: 'analysisVersion', type: 'integer', default: 0 }),
            );
            await runner.query(
                'UPDATE `video_file` SET `analysisVersion` = 1 WHERE `analyzedAt` IS NOT NULL AND `analysisError` IS NULL',
            );
        }
        if (await runner.hasTable('video_file_keyframe_info')) return;
        await runner.createTable(
            new Table({
                name: 'video_file_keyframe_info',
                engine: 'InnoDB',
                columns: [
                    { name: 'videoFileId', type: 'integer', isPrimary: true },
                    { name: 'version', type: 'integer', default: 0 },
                    { name: 'status', type: 'varchar', length: '24', default: "'pending'" },
                    { name: 'sourceSize', type: 'bigint' },
                    { name: 'sourceMtime', type: 'bigint' },
                    { name: 'requestedAt', type: 'bigint' },
                    { name: 'attemptedAt', type: 'bigint', isNullable: true },
                    { name: 'result', type: 'text', isNullable: true },
                    { name: 'error', type: 'text', isNullable: true },
                ],
                foreignKeys: [
                    new TableForeignKey({
                        columnNames: ['videoFileId'],
                        referencedTableName: 'video_file',
                        referencedColumnNames: ['id'],
                        onDelete: 'CASCADE',
                    }),
                ],
                indices: [
                    new TableIndex({ name: 'IDX_keyframe_status_requested', columnNames: ['status', 'requestedAt'] }),
                ],
            }),
        );
    }
    public async down(runner: QueryRunner): Promise<void> {
        if (await runner.hasTable('video_file_keyframe_info')) await runner.dropTable('video_file_keyframe_info');
        if (await runner.hasColumn('video_file', 'analysisVersion'))
            await runner.dropColumn('video_file', 'analysisVersion');
    }
}
