import { BaseEntity, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export default class EncodeTask extends BaseEntity {
    @PrimaryColumn({ type: 'integer' })
    public encodeId!: number;

    @Column({ type: 'text' })
    public optionJson!: string;

    @Column({ type: 'varchar', length: 32 })
    public status!: string;

    @Column({ type: 'integer' })
    public position!: number;

    @Column({ type: 'varchar', length: 64 })
    public ownerFingerprint!: string;

    @Column({ type: 'bigint' })
    public startedAt!: number;

    @Column({ type: 'text', nullable: true })
    public outputFilePath!: string | null;

    @Column({ type: 'bigint' })
    public createdAt!: number;

    @Column({ type: 'bigint' })
    public updatedAt!: number;
}
