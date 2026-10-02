import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './Tenant';

@Entity('projects')
@Unique('uq_projects_tenant_external', ['tenantId', 'externalId'])
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Index()
  @Column({ name: 'external_id' })
  externalId: string;

  @Column()
  name: string;

  @Column({ default: 'active' })
  status: string;

  @Column({ name: 'site_address', type: 'text', nullable: true })
  siteAddress: string | null;

  @Column({ name: 'budget_cents', type: 'bigint', nullable: true })
  budgetCents: string | null;

  @Column({ name: 'source_updated_at', type: 'timestamptz', nullable: true })
  sourceUpdatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
