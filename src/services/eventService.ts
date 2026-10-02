import { AppDataSource } from '../data-source';
import { Contact } from '../entities/Contact';
import { Project } from '../entities/Project';
import { Tenant } from '../entities/Tenant';
import { logger } from '../logger';

export type BuildcoEventType =
  | 'project.created'
  | 'project.updated'
  | 'contact.created'
  | 'contact.updated';

export interface BuildcoEvent {
  id: string;
  type: BuildcoEventType;
  occurred_at: string;
  data: Record<string, unknown>;
}

interface ProjectPayload {
  name?: string;
  projectStatus?: string;
  site_address?: string | null;
  budget_cents?: number | null;
  contacts?: ContactPayload[];
}

interface ContactPayload {
  id?: string;
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  project_id?: string;
}

export function isStale(existing: Date | null | undefined, incoming: Date): boolean {
  if (!existing) {
    return false;
  }
  return existing.getTime() > incoming.getTime();
}

export async function processEvent(tenant: Tenant, event: BuildcoEvent): Promise<void> {
  switch (event.type) {
    case 'project.created':
    case 'project.updated':
      await applyProject(tenant, event);
      break;
    case 'contact.created':
    case 'contact.updated':
      await applyContact(tenant, event, event.id, event.data as ContactPayload);
      break;
  }
}

async function applyProject(tenant: Tenant, event: BuildcoEvent): Promise<void> {
  const projectRepo = AppDataSource.getRepository(Project);
  const incoming = new Date(event.occurred_at);
  const data = event.data as ProjectPayload;

  let project = await projectRepo.findOne({
    where: { tenantId: tenant.id, externalId: event.id },
  });

  if (project && isStale(project.sourceUpdatedAt, incoming)) {
    logger.info(
      { tenantId: tenant.id, externalId: event.id, occurredAt: event.occurred_at },
      'skipping stale project event',
    );
    return;
  }

  if (!project) {
    project = projectRepo.create({
      tenantId: tenant.id,
      externalId: event.id,
      name: data.name ?? '',
      status: data.projectStatus ?? 'active',
      siteAddress: data.site_address ?? null,
      budgetCents: data.budget_cents != null ? String(data.budget_cents) : null,
    });
  } else {
    if (data.name !== undefined) {
      project.name = data.name;
    }
    if (data.projectStatus !== undefined) {
      project.status = data.projectStatus;
    }
    if (data.site_address !== undefined) {
      project.siteAddress = data.site_address;
    }
    if (data.budget_cents !== undefined) {
      project.budgetCents = data.budget_cents != null ? String(data.budget_cents) : null;
    }
  }

  project.sourceUpdatedAt = incoming;
  const saved = await projectRepo.save(project);

  if (event.type !== 'project.created') {
    return;
  }

  for (const payload of data.contacts ?? []) {
    if (!payload.id) {
      continue;
    }
    await applyContact(tenant, event, payload.id, payload, saved.id);
  }
}

async function applyContact(
  tenant: Tenant,
  event: BuildcoEvent,
  externalId: string,
  data: ContactPayload,
  embeddedProjectId?: string,
): Promise<void> {
  const contactRepo = AppDataSource.getRepository(Contact);
  const incoming = new Date(event.occurred_at);

  let contact = await contactRepo.findOne({
    where: { tenantId: tenant.id, externalId },
  });

  if (contact && isStale(contact.sourceUpdatedAt, incoming)) {
    logger.info(
      { tenantId: tenant.id, externalId, occurredAt: event.occurred_at },
      'skipping stale contact event',
    );
    return;
  }

  let projectId = embeddedProjectId ?? contact?.projectId ?? null;
  if (embeddedProjectId === undefined && data.project_id) {
    const projectRepo = AppDataSource.getRepository(Project);
    const project = await projectRepo.findOne({
      where: { tenantId: tenant.id, externalId: data.project_id },
    });
    projectId = project ? project.id : null;
  }

  if (!contact) {
    contact = contactRepo.create({
      tenantId: tenant.id,
      projectId,
      externalId,
      fullName: data.fullName ?? '',
      email: data.email ?? null,
      phone: data.phone ?? null,
      role: data.role ?? null,
    });
  } else {
    if (data.fullName !== undefined) {
      contact.fullName = data.fullName;
    }
    if (data.email !== undefined) {
      contact.email = data.email;
    }
    if (data.phone !== undefined) {
      contact.phone = data.phone;
    }
    if (data.role !== undefined) {
      contact.role = data.role;
    }
    if (embeddedProjectId !== undefined || data.project_id) {
      contact.projectId = projectId;
    }
  }

  contact.sourceUpdatedAt = incoming;
  await contactRepo.save(contact);
}
