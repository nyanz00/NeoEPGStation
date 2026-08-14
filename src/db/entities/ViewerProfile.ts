import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
@Index('IDX_viewer_profile_tv_user_id', ['tvUserId'], { unique: true })
export default class ViewerProfile extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' })
    public id!: number;

    @Column({ type: 'text' })
    public name!: string;

    @Column({ type: 'integer', nullable: true })
    public tvUserId?: number | null;

    @Column({ type: 'text' })
    public pinSalt!: string;

    @Column({ type: 'text' })
    public pinHash!: string;

    @Column({ type: 'text', default: '' })
    public recoveryCodeSalt!: string;

    @Column({ type: 'text', default: '' })
    public recoveryCodeHash!: string;

    @Column({ type: 'bigint' })
    public createdAt!: number;

    @Column({ type: 'bigint' })
    public updatedAt!: number;
}
