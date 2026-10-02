jest.mock('../src/data-source', () => ({
  AppDataSource: { getRepository: jest.fn() },
}));

const reportUsage = jest.fn();
const listProjects = jest.fn();
const listContacts = jest.fn();

jest.mock('../src/clients/buildco', () => ({
  BuildcoClient: jest.fn().mockImplementation(() => ({
    listProjects,
    listContacts,
    reportUsage,
  })),
}));

import { AppDataSource } from '../src/data-source';
import { Contact } from '../src/entities/Contact';
import { Project } from '../src/entities/Project';
import { Tenant } from '../src/entities/Tenant';
import { syncTenant } from '../src/services/reconcileService';

const tenant = {
  id: 'tenant-1',
  name: 'Acme',
  buildcoAccountId: 'acct-100',
  buildcoApiKey: 'key-100',
} as Tenant;

const projectRepo = {
  create: jest.fn((values: object) => ({ ...values })),
  save: jest.fn(async (values: object) => values),
  findOne: jest.fn(),
};
const contactRepo = {
  create: jest.fn((values: object) => ({ ...values })),
  save: jest.fn(async (values: object) => values),
  findOne: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  listProjects.mockResolvedValue({ items: [], page: 1, has_more: false });
  listContacts.mockResolvedValue({ items: [], page: 1, has_more: false });
  reportUsage.mockResolvedValue(undefined);
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
    if (entity === Project) return projectRepo;
    if (entity === Contact) return contactRepo;
    throw new Error('unexpected entity');
  });
});

describe('syncTenant', () => {
  it('does not overwrite a project that is newer locally than the API snapshot', async () => {
    listProjects.mockResolvedValue({
      items: [
        {
          id: 'bc-proj-1',
          name: 'Stale From API',
          projectStatus: 'on_hold',
          site_address: null,
          budget_cents: null,
          updated_at: '2024-06-18T00:00:00Z',
        },
      ],
      page: 1,
      has_more: false,
    });
    projectRepo.findOne.mockResolvedValue({
      id: 'project-1',
      tenantId: 'tenant-1',
      externalId: 'bc-proj-1',
      name: 'Webhook Newer',
      status: 'active',
      sourceUpdatedAt: new Date('2024-06-20T00:00:00Z'),
    });

    const summary = await syncTenant(tenant);

    expect(projectRepo.save).not.toHaveBeenCalled();
    expect(summary.projectsUpserted).toBe(0);
  });

  it('still succeeds the tenant when usage reporting fails', async () => {
    reportUsage.mockRejectedValue(new Error('usage endpoint down'));

    const summary = await syncTenant(tenant);

    expect(summary).toEqual({ projectsUpserted: 0, contactsUpserted: 0 });
  });
});
