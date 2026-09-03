import { BaseEntity, Column, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import Recorded from './Recorded';

@Entity()
export default class VideoFile extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'text',
    })
    public parentDirectoryName!: string;

    @Column({
        type: 'text',
    })
    public filePath!: string;

    @Column({
        type: 'text',
    })
    public type!: string; // apid.VideoFileType

    @Column({
        type: 'text',
    })
    public name!: string;

    @Column({
        type: 'bigint',
        default: 0,
    })
    public size: number = 0;

    @Column({ type: 'float', nullable: true })
    public duration: number | null = null;

    @Column({ type: 'float', nullable: true })
    public startTime: number | null = null;

    @Column({ type: 'text', nullable: true })
    public formatName: string | null = null;

    @Column({ type: 'text', nullable: true })
    public videoCodec: string | null = null;

    @Column({ type: 'text', nullable: true })
    public videoProfile: string | null = null;

    @Column({ type: 'integer', nullable: true })
    public width: number | null = null;

    @Column({ type: 'integer', nullable: true })
    public height: number | null = null;

    @Column({ type: 'float', nullable: true })
    public frameRate: number | null = null;

    @Column({ type: 'text', nullable: true })
    public pixelFormat: string | null = null;

    @Column({ type: 'integer', nullable: true })
    public bitDepth: number | null = null;

    @Column({ type: 'text', nullable: true })
    public hdr: string | null = null;

    @Column({ type: 'float', nullable: true })
    public bitRate: number | null = null;

    /** ffprobe のストリーム一覧。JSON 配列として保存する。 */
    @Column({ type: 'text', nullable: true })
    public streamInfo: string | null = null;

    @Column({ type: 'bigint', nullable: true })
    public analyzedSize: number | null = null;

    @Column({ type: 'bigint', nullable: true })
    public analyzedMtime: number | null = null;

    @Column({ type: 'bigint', nullable: true })
    public analyzedAt: number | null = null;

    @Column({ type: 'text', nullable: true })
    public analysisError: string | null = null;

    @Column()
    public recordedId!: number;

    @ManyToOne(() => Recorded, recorded => recorded.videoFiles)
    @JoinTable({ name: 'recordedId' })
    public recorded?: Recorded;
}
