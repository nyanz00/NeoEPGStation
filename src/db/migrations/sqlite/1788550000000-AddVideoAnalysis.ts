import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVideoAnalysis1788550000000 implements MigrationInterface {
    name = 'AddVideoAnalysis1788550000000';
    public async up(q: QueryRunner): Promise<void> {
        const columns: Array<[string, string]> = [
            ['duration', 'float'],
            ['startTime', 'float'],
            ['formatName', 'text'],
            ['videoCodec', 'text'],
            ['videoProfile', 'text'],
            ['width', 'integer'],
            ['height', 'integer'],
            ['frameRate', 'float'],
            ['pixelFormat', 'text'],
            ['bitDepth', 'integer'],
            ['hdr', 'text'],
            ['bitRate', 'float'],
            ['streamInfo', 'text'],
            ['analyzedSize', 'bigint'],
            ['analyzedMtime', 'bigint'],
            ['analyzedAt', 'bigint'],
            ['analysisError', 'text'],
        ];
        for (const [name, type] of columns) {
            if (!(await q.hasColumn('video_file', name)))
                await q.query(`ALTER TABLE "video_file" ADD COLUMN "${name}" ${type}`);
        }
        if (!(await q.hasTable('video_file_ts_info'))) {
            await q.query(`CREATE TABLE "video_file_ts_info" (
                "videoFileId" integer PRIMARY KEY NOT NULL,
                "networkId" integer, "transportStreamId" integer, "serviceId" integer, "serviceType" integer,
                "serviceName" text, "serviceProviderName" text, "networkName" text,
                "eventId" integer, "eventName" text, "eventDescription" text, "eventExtended" text,
                "eventStartAt" bigint, "eventDuration" integer,
                "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer,
                "genre3" integer, "subGenre3" integer,
                "videoStreamType" integer, "videoPid" integer, "audioStreamType" integer, "audioPid" integer,
                "pmtPid" integer, "pcrPid" integer, "subtitlePid" integer,
                "firstTdtAt" bigint, "analyzedSize" bigint NOT NULL, "analyzedMtime" bigint NOT NULL,
                "analyzedAt" bigint NOT NULL, "analysisError" text,
                CONSTRAINT "FK_video_file_ts_info_video_file" FOREIGN KEY ("videoFileId") REFERENCES "video_file" ("id") ON DELETE CASCADE
            )`);
            await q.query(
                `CREATE INDEX "IDX_video_file_ts_info_service" ON "video_file_ts_info" ("networkId", "serviceId")`,
            );
        }
    }
    public async down(q: QueryRunner): Promise<void> {
        if (await q.hasTable('video_file_ts_info')) await q.query('DROP TABLE "video_file_ts_info"');
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
            if (await q.hasColumn('video_file', name)) await q.query(`ALTER TABLE "video_file" DROP COLUMN "${name}"`);
        }
    }
}
