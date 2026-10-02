import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config';
import { Contact } from './entities/Contact';
import { Project } from './entities/Project';
import { Tenant } from './entities/Tenant';
import { InitialSchema1718700000000 } from './migrations/1718700000000-InitialSchema';
import { TenantExternalUnique1718700000001 } from './migrations/1718700000001-TenantExternalUnique';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: config.databaseUrl,
  entities: [Tenant, Project, Contact],
  migrations: [InitialSchema1718700000000, TenantExternalUnique1718700000001],
  synchronize: false,
  logging: false,
});
