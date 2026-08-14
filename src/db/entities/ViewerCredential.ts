import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
@Index(['viewerProfileId', 'provider'], { unique: true })
export default class ViewerCredential extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' })
    public id!: number;

    @Column({ type: 'integer' })
    public viewerProfileId!: number;

    @Column({ type: 'text' })
    public provider!: string;

    @Column({ type: 'text' })
    public encryptedValue!: string;

    @Column({ type: 'text' })
    public iv!: string;

    @Column({ type: 'text' })
    public authTag!: string;

    @Column({ type: 'bigint' })
    public createdAt!: number;

    @Column({ type: 'bigint' })
    public updatedAt!: number;
}
