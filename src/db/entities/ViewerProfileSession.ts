import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
@Index(['tokenHash'], { unique: true })
export default class ViewerProfileSession extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' })
    public id!: number;

    @Column({ type: 'integer' })
    public viewerProfileId!: number;

    @Column({ type: 'text' })
    public tokenHash!: string;

    @Column({ type: 'bigint' })
    public createdAt!: number;
}
