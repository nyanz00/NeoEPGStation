import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVideoAnalysis1788550000001 implements MigrationInterface {
    name = 'AddVideoAnalysis1788550000001';
    public async up(q: QueryRunner): Promise<void> {
        const columns: Array<[string, string]> = [
            ['duration', 'double'],
            ['startTime', 'double'],
            ['formatName', 'text'],
            ['videoCodec', 'text'],
            ['videoProfile', 'text'],
            ['width', 'int'],
            ['height', 'int'],
            ['frameRate', 'double'],
            ['pixelFormat', 'text'],
            ['bitDepth', 'int'],
            ['hdr', 'text'],
            ['bitRate', 'double'],
            ['streamInfo', 'longtext'],
            ['analyzedSize', 'bigint'],
            ['analyzedMtime', 'bigint'],
            ['analyzedAt', 'bigint'],
            ['analysisError', 'text'],
        ];
        for (const [name, type] of columns) {
            if (!(await q.hasColumn('video_file', name)))
                await q.query(`ALTER TABLE \`video_file\` ADD \`${name}\` ${type} NULL`);
        }
        if (!(await q.hasTable('video_file_ts_info'))) {
            await q.query(`CREATE TABLE \`video_file_ts_info\` (
                \`videoFileId\` int NOT NULL, \`networkId\` int NULL, \`transportStreamId\` int NULL,
                \`serviceId\` int NULL, \`serviceType\` int NULL, \`serviceName\` text NULL,
                \`serviceProviderName\` text NULL, \`networkName\` text NULL, \`eventId\` int NULL,
                \`eventName\` text NULL, \`eventDescription\` text NULL, \`eventExtended\` text NULL,
                \`eventStartAt\` bigint NULL, \`eventDuration\` int NULL,
                \`genre1\` int NULL, \`subGenre1\` int NULL, \`genre2\` int NULL, \`subGenre2\` int NULL,
                \`genre3\` int NULL, \`subGenre3\` int NULL, \`videoStreamType\` int NULL, \`videoPid\` int NULL,
                \`audioStreamType\` int NULL, \`audioPid\` int NULL, \`pmtPid\` int NULL, \`pcrPid\` int NULL,
                \`subtitlePid\` int NULL, \`firstTdtAt\` bigint NULL,
                \`analyzedSize\` bigint NOT NULL, \`analyzedMtime\` bigint NOT NULL, \`analyzedAt\` bigint NOT NULL,
                \`analysisError\` text NULL, PRIMARY KEY (\`videoFileId\`),
                INDEX \`IDX_video_file_ts_info_service\` (\`networkId\`, \`serviceId\`),
                CONSTRAINT \`FK_video_file_ts_info_video_file\` FOREIGN KEY (\`videoFileId\`) REFERENCES \`video_file\`(\`id\`) ON DELETE CASCADE
            ) ENGINE=InnoDB`);
        }
    }
    public async down(q: QueryRunner): Promise<void> {
        if (await q.hasTable('video_file_ts_info')) await q.query('DROP TABLE `video_file_ts_info`');
        for (const name of [
            'analysisError',
            'analyzedAt',
            'analyzedMtime',
            'analyzedSize',
            'streamInfo',
            'bitRate',
            'hdr',
            'bitDepth',
            'pixelFormat',
            'frameRate',
            'height',
            'width',
            'videoProfile',
            'videoCodec',
            'formatName',
            'startTime',
            'duration',
        ]) {
            if (await q.hasColumn('video_file', name))
                await q.query(`ALTER TABLE \`video_file\` DROP COLUMN \`${name}\``);
        }
    }
}
