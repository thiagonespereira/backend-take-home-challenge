jest.mock('../src/data-source', () => ({
  AppDataSource: { getRepository: jest.fn() },
}));

import { AppDataSource } from '../src/data-source';
import { Contact } from '../src/entities/Contact';
import { Project } from '../src/entities/Project';
import { Tenant } from '../src/entities/Tenant';
import { BuildcoEvent, processEvent } from '../src/services/eventService';

const tenant = {
  id: 'tenant-1',
  name: 'Acme Construction',
  buildcoAccountId: 'acct-100',
  buildcoApiKey: 'key-100',
} as Tenant;

type ProjectRow = {
  id: string;
  tenantId: string;
  externalId: string;
  name: string;
  status: string;
  siteAddress: string | null;
  budgetCents: string | null;
  sourceUpdatedAt: Date | null;
};

const projects = new Map<string, ProjectRow>();
let projectSeq = 0;

function projectKey(tenantId: string, externalId: string): string {
  return `${tenantId}:${externalId}`;
}

const projectRepo = {
  create: jest.fn((values: object) => ({ ...values })),
  save: jest.fn(async (values: ProjectRow) => {
    const row = {
      ...values,
      id: values.id ?? `project-${++projectSeq}`,
    };
    projects.set(projectKey(row.tenantId, row.externalId), row);
    return row;
  }),
  findOne: jest.fn(async ({ where }: { where: { tenantId: string; externalId: string } }) => {
    return projects.get(projectKey(where.tenantId, where.externalId)) ?? null;
  }),
};

const contactRepo = {
  create: jest.fn((values: object) => ({ ...values })),
  save: jest.fn(async (values: object) => values),
  findOne: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  projects.clear();
  projectSeq = 0;
  contactRepo.findOne.mockResolvedValue(null);
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
    if (entity === Project) return projectRepo;
    if (entity === Contact) return contactRepo;
    throw new Error('unexpected entity');
  });
});

describe('processEvent', () => {
  it('saves a contact from a contact.created event', async () => {
    const event: BuildcoEvent = {
      id: 'bc-cont-9',
      type: 'contact.created',
      occurred_at: '2024-06-18T10:00:00Z',
      data: { fullName: 'Dana Reyes', email: 'dana@example.com', role: 'foreman' },
    };

    await processEvent(tenant, event);

    expect(contactRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', externalId: 'bc-cont-9' },
    });
    expect(contactRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        externalId: 'bc-cont-9',
        fullName: 'Dana Reyes',
        email: 'dana@example.com',
        role: 'foreman',
      }),
    );
  });

  it('applies field changes from a project.updated event', async () => {
    projects.set(projectKey('tenant-1', 'bc-proj-1'), {
      id: 'project-1',
      tenantId: 'tenant-1',
      externalId: 'bc-proj-1',
      name: 'Riverside Tower',
      status: 'active',
      siteAddress: null,
      budgetCents: null,
      sourceUpdatedAt: new Date('2024-06-18T08:00:00Z'),
    });

    const event: BuildcoEvent = {
      id: 'bc-proj-1',
      type: 'project.updated',
      occurred_at: '2024-06-19T08:00:00Z',
      data: { name: 'Riverside Tower Phase 2', projectStatus: 'on_hold' },
    };

    await processEvent(tenant, event);

    expect(projectRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', externalId: 'bc-proj-1' },
    });
    expect(projectRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'project-1',
        name: 'Riverside Tower Phase 2',
        status: 'on_hold',
      }),
    );
  });

  it('upserts a project.updated event when the row does not exist', async () => {
    const event: BuildcoEvent = {
      id: 'bc-proj-new',
      type: 'project.updated',
      occurred_at: '2024-06-19T08:00:00Z',
      data: { name: 'Harbor Works', projectStatus: 'active' },
    };

    await processEvent(tenant, event);

    expect(projectRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        externalId: 'bc-proj-new',
        name: 'Harbor Works',
        status: 'active',
      }),
    );
  });

  it('does not duplicate a project.created retry for the same tenant and external id', async () => {
    const event: BuildcoEvent = {
      id: 'bc-proj-1',
      type: 'project.created',
      occurred_at: '2024-06-18T09:30:00Z',
      data: { name: 'Riverside Tower', projectStatus: 'active' },
    };

    await processEvent(tenant, event);
    await processEvent(tenant, event);

    expect(projectRepo.save).toHaveBeenCalledTimes(2);
    expect([...projects.values()]).toHaveLength(1);
    expect([...projects.values()][0].id).toBe('project-1');
  });

  it('does not apply a project update to another tenant with the same external id', async () => {
    projects.set(projectKey('tenant-2', 'bc-proj-1'), {
      id: 'project-other',
      tenantId: 'tenant-2',
      externalId: 'bc-proj-1',
      name: 'Other Tower',
      status: 'active',
      siteAddress: null,
      budgetCents: null,
      sourceUpdatedAt: new Date('2024-06-18T08:00:00Z'),
    });

    const event: BuildcoEvent = {
      id: 'bc-proj-1',
      type: 'project.updated',
      occurred_at: '2024-06-19T08:00:00Z',
      data: { name: 'Hijacked', projectStatus: 'cancelled' },
    };

    await processEvent(tenant, event);

    expect(projects.get(projectKey('tenant-2', 'bc-proj-1'))?.name).toBe('Other Tower');
    expect(projects.get(projectKey('tenant-1', 'bc-proj-1'))?.name).toBe('Hijacked');
  });

  it('skips a stale project event and does not rewind sourceUpdatedAt', async () => {
    projects.set(projectKey('tenant-1', 'bc-proj-1'), {
      id: 'project-1',
      tenantId: 'tenant-1',
      externalId: 'bc-proj-1',
      name: 'Current Name',
      status: 'active',
      siteAddress: null,
      budgetCents: null,
      sourceUpdatedAt: new Date('2024-06-20T00:00:00Z'),
    });

    const event: BuildcoEvent = {
      id: 'bc-proj-1',
      type: 'project.updated',
      occurred_at: '2024-06-19T08:00:00Z',
      data: { name: 'Stale Name', projectStatus: 'on_hold' },
    };

    await processEvent(tenant, event);

    expect(projectRepo.save).not.toHaveBeenCalled();
    const row = projects.get(projectKey('tenant-1', 'bc-proj-1'));
    expect(row?.name).toBe('Current Name');
    expect(row?.sourceUpdatedAt).toEqual(new Date('2024-06-20T00:00:00Z'));
  });

  it('does not save embedded contacts that lack an id', async () => {
    const event: BuildcoEvent = {
      id: 'bc-proj-1',
      type: 'project.created',
      occurred_at: '2024-06-18T09:30:00Z',
      data: {
        name: 'Riverside Tower',
        contacts: [{ fullName: 'No Id' }],
      },
    };

    await processEvent(tenant, event);

    expect(contactRepo.save).not.toHaveBeenCalled();
  });
});
