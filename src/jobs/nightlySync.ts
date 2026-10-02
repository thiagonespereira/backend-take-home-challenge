import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { Tenant } from '../entities/Tenant';
import { logger } from '../logger';
import { syncTenant } from '../services/reconcileService';

export async function syncAllTenants(): Promise<{ failedTenantIds: string[] }> {
  const tenants = await AppDataSource.getRepository(Tenant).find();
  logger.info({ tenantCount: tenants.length }, 'starting nightly sync');

  const failedTenantIds: string[] = [];
  for (const tenant of tenants) {
    try {
      const summary = await syncTenant(tenant);
      logger.info(
        {
          tenantId: tenant.id,
          projectsUpserted: summary.projectsUpserted,
          contactsUpserted: summary.contactsUpserted,
        },
        'tenant sync finished',
      );
    } catch (err) {
      failedTenantIds.push(tenant.id);
      logger.error({ err, tenantId: tenant.id }, 'tenant sync failed');
    }
  }

  return { failedTenantIds };
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const { failedTenantIds } = await syncAllTenants();
    if (failedTenantIds.length > 0) {
      logger.error({ failedTenantIds }, 'nightly sync completed with tenant failures');
      process.exitCode = 1;
    }
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, 'nightly sync failed');
    process.exit(1);
  });
}
