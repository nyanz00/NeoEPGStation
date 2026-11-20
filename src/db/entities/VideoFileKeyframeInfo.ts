import { BaseEntity, Column, Entity, Index, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import VideoFile from './VideoFile.js';

/** Rebuildable analysis cache and durable work requests, separate from basic metadata. */
@Entity()
@Index('IDX_keyframe_status_requested', ['status', 'requestedAt'])
export default class VideoFileKeyframeInfo extends BaseEntity {
    @PrimaryColumn({ type: 'integer' }) public videoFileId!: number;
    @Column({ type: 'integer', default: 0 }) public version = 0;
    @Column({ type: 'varchar', length: 24, default: 'pending' }) public status = 'pending';
    @Column({ type: 'bigint' }) public sourceSize!: number;
    @Column({ type: 'bigint' }) public sourceMtime!: number;
    @Column({ type: 'bigint' }) public requestedAt!: number;
    @Column({ type: 'bigint', nullable: true }) public attemptedAt: number | null = null;
    @Column({ type: 'text', nullable: true }) public result: string | null = null;
    @Column({ type: 'text', nullable: true }) public error: string | null = null;
    @OneToOne(() => VideoFile, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'videoFileId' })
    public videoFile?: VideoFile;
}
