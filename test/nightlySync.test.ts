jest.mock('../src/data-source', () => ({
  AppDataSource: { getRepository: jest.fn() },
}));

jest.mock('../src/services/reconcileService', () => ({
  syncTenant: jest.fn(),
}));

import { AppDataSource } from '../src/data-source';
import { Tenant } from '../src/entities/Tenant';
import { syncAllTenants } from '../src/jobs/nightlySync';
import { syncTenant } from '../src/services/reconcileService';

const tenantRepo = { find: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
    if (entity === Tenant) return tenantRepo;
    throw new Error('unexpected entity');
  });
});

describe('syncAllTenants', () => {
  it('continues to later tenants when one sync throws', async () => {
    const tenants = [
      { id: 'tenant-1', name: 'A', buildcoAccountId: 'acct-1', buildcoApiKey: 'k1' },
      { id: 'tenant-2', name: 'B', buildcoAccountId: 'acct-2', buildcoApiKey: 'k2' },
    ];
    tenantRepo.find.mockResolvedValue(tenants);
    (syncTenant as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ projectsUpserted: 3, contactsUpserted: 1 });

    const result = await syncAllTenants();

    expect(syncTenant).toHaveBeenCalledTimes(2);
    expect(syncTenant).toHaveBeenNthCalledWith(1, tenants[0]);
    expect(syncTenant).toHaveBeenNthCalledWith(2, tenants[1]);
    expect(result.failedTenantIds).toEqual(['tenant-1']);
  });
});
