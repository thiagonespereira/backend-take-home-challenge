import { createHmac } from 'crypto';
import request from 'supertest';

jest.mock('../src/config', () => ({
  config: {
    port: 3000,
    databaseUrl: 'postgres://localhost/test',
    logLevel: 'silent',
    buildco: {
      baseUrl: 'https://api.buildco.test/v1',
      apiKey: 'global-key-must-not-be-used',
      webhookSecret: 'test-webhook-secret',
    },
  },
}));

jest.mock('../src/data-source', () => ({
  AppDataSource: { getRepository: jest.fn() },
}));

import { createApp } from '../src/app';
import { AppDataSource } from '../src/data-source';
import { Contact } from '../src/entities/Contact';
import { Project } from '../src/entities/Project';
import { Tenant } from '../src/entities/Tenant';

const WEBHOOK_SECRET = 'test-webhook-secret';

function sign(body: unknown): string {
  const raw = JSON.stringify(body);
  return `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')}`;
}

const tenant = {
  id: 'tenant-1',
  name: 'Acme Construction',
  buildcoAccountId: 'acct-100',
  buildcoApiKey: 'key-100',
};

const tenantRepo = { findOne: jest.fn() };
const projectRepo = {
  create: jest.fn((values: object) => values),
  save: jest.fn(async (values: object) => ({ id: 'project-1', ...values })),
  findOne: jest.fn(),
};
const contactRepo = {
  create: jest.fn((values: object) => values),
  save: jest.fn(async (values: object) => ({ id: 'contact-1', ...values })),
  findOne: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  tenantRepo.findOne.mockResolvedValue(tenant);
  projectRepo.findOne.mockResolvedValue(null);
  contactRepo.findOne.mockResolvedValue(null);
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
    if (entity === Tenant) return tenantRepo;
    if (entity === Project) return projectRepo;
    if (entity === Contact) return contactRepo;
    throw new Error('unexpected entity');
  });
});

describe('POST /webhooks/buildco', () => {
  const validEvent = {
    id: 'bc-proj-1',
    type: 'project.created',
    occurred_at: '2024-06-18T09:30:00Z',
    data: { name: 'Riverside Tower', projectStatus: 'active' },
  };

  it('rejects a request without a signature', async () => {
    const res = await request(createApp())
      .post('/webhooks/buildco')
      .set('X-BuildCo-Account', 'acct-100')
      .send(validEvent);

    expect(res.status).toBe(401);
    expect(projectRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a request with an invalid signature', async () => {
    const res = await request(createApp())
      .post('/webhooks/buildco')
      .set('X-BuildCo-Signature', 'sha256=abc')
      .set('X-BuildCo-Account', 'acct-100')
      .send(validEvent);

    expect(res.status).toBe(401);
    expect(tenantRepo.findOne).not.toHaveBeenCalled();
    expect(projectRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a tampered body with a signature for a different payload', async () => {
    const res = await request(createApp())
      .post('/webhooks/buildco')
      .set('X-BuildCo-Signature', sign(validEvent))
      .set('X-BuildCo-Account', 'acct-100')
      .send({ ...validEvent, data: { name: 'Forged' } });

    expect(res.status).toBe(401);
    expect(projectRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a request without the account header', async () => {
    const res = await request(createApp())
      .post('/webhooks/buildco')
      .set('X-BuildCo-Signature', sign(validEvent))
      .send(validEvent);

    expect(res.status).toBe(400);
  });

  it('rejects a payload with an unknown event type', async () => {
    const body = { ...validEvent, type: 'project.archived' };
    const res = await request(createApp())
      .post('/webhooks/buildco')
      .set('X-BuildCo-Signature', sign(body))
      .set('X-BuildCo-Account', 'acct-100')
      .send(body);

    expect(res.status).toBe(400);
  });

  it('stores a project from a project.created event', async () => {
    const res = await request(createApp())
      .post('/webhooks/buildco')
      .set('X-BuildCo-Signature', sign(validEvent))
      .set('X-BuildCo-Account', 'acct-100')
      .send(validEvent);

    expect(res.status).toBe(202);
    expect(projectRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', externalId: 'bc-proj-1' },
    });
    expect(projectRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        externalId: 'bc-proj-1',
        name: 'Riverside Tower',
        status: 'active',
      }),
    );
  });
});
