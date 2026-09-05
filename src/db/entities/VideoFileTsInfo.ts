import { BaseEntity, Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import VideoFile from './VideoFile';

@Entity()
export default class VideoFileTsInfo extends BaseEntity {
    @PrimaryColumn({ type: 'integer' }) public videoFileId!: number;
    @Column({ type: 'integer', nullable: true }) public networkId: number | null = null;
    @Column({ type: 'integer', nullable: true }) public transportStreamId: number | null = null;
    @Column({ type: 'integer', nullable: true }) public serviceId: number | null = null;
    @Column({ type: 'integer', nullable: true }) public serviceType: number | null = null;
    @Column({ type: 'text', nullable: true }) public serviceName: string | null = null;
    @Column({ type: 'text', nullable: true }) public serviceProviderName: string | null = null;
    @Column({ type: 'text', nullable: true }) public networkName: string | null = null;
    @Column({ type: 'integer', nullable: true }) public eventId: number | null = null;
    @Column({ type: 'text', nullable: true }) public eventName: string | null = null;
    @Column({ type: 'text', nullable: true }) public eventDescription: string | null = null;
    @Column({ type: 'text', nullable: true }) public eventExtended: string | null = null;
    @Column({ type: 'bigint', nullable: true }) public eventStartAt: number | null = null;
    @Column({ type: 'integer', nullable: true }) public eventDuration: number | null = null;
    @Column({ type: 'integer', nullable: true }) public genre1: number | null = null;
    @Column({ type: 'integer', nullable: true }) public subGenre1: number | null = null;
    @Column({ type: 'integer', nullable: true }) public genre2: number | null = null;
    @Column({ type: 'integer', nullable: true }) public subGenre2: number | null = null;
    @Column({ type: 'integer', nullable: true }) public genre3: number | null = null;
    @Column({ type: 'integer', nullable: true }) public subGenre3: number | null = null;
    @Column({ type: 'integer', nullable: true }) public videoStreamType: number | null = null;
    @Column({ type: 'integer', nullable: true }) public videoPid: number | null = null;
    @Column({ type: 'integer', nullable: true }) public audioStreamType: number | null = null;
    @Column({ type: 'integer', nullable: true }) public audioPid: number | null = null;
    @Column({ type: 'integer', nullable: true }) public pmtPid: number | null = null;
    @Column({ type: 'integer', nullable: true }) public pcrPid: number | null = null;
    @Column({ type: 'integer', nullable: true }) public subtitlePid: number | null = null;
    @Column({ type: 'bigint', nullable: true }) public firstTdtAt: number | null = null;
    @Column({ type: 'bigint' }) public analyzedSize!: number;
    @Column({ type: 'bigint' }) public analyzedMtime!: number;
    @Column({ type: 'bigint' }) public analyzedAt!: number;
    @Column({ type: 'text', nullable: true }) public analysisError: string | null = null;
    @OneToOne(() => VideoFile, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'videoFileId' })
    public videoFile?: VideoFile;
}
