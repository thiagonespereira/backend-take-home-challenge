import { BuildcoClient, BuildcoContactDto, BuildcoProjectDto } from '../clients/buildco';
import { AppDataSource } from '../data-source';
import { Contact } from '../entities/Contact';
import { Project } from '../entities/Project';
import { Tenant } from '../entities/Tenant';
import { logger } from '../logger';
import { isStale } from './eventService';

export interface SyncSummary {
  projectsUpserted: number;
  contactsUpserted: number;
}

export async function syncTenant(tenant: Tenant): Promise<SyncSummary> {
  const client = new BuildcoClient(tenant.buildcoApiKey);
  const projectRepo = AppDataSource.getRepository(Project);
  const contactRepo = AppDataSource.getRepository(Contact);

  const remoteProjects: BuildcoProjectDto[] = [];
  let page = 1;
  for (;;) {
    const batch = await client.listProjects(page);
    remoteProjects.push(...batch.items);
    if (!batch.has_more) break;
    page += 1;
  }

  const remoteContacts: BuildcoContactDto[] = [];
  page = 1;
  for (;;) {
    const batch = await client.listContacts(page);
    remoteContacts.push(...batch.items);
    if (!batch.has_more) break;
    page += 1;
  }

  let projectsUpserted = 0;
  for (const dto of remoteProjects) {
    const incoming = new Date(dto.updated_at);
    let project = await projectRepo.findOne({ where: { tenantId: tenant.id, externalId: dto.id } });
    if (project && isStale(project.sourceUpdatedAt, incoming)) {
      continue;
    }
    if (!project) {
      project = projectRepo.create({ tenantId: tenant.id, externalId: dto.id });
    }
    project.name = dto.name;
    project.status = dto.projectStatus;
    project.siteAddress = dto.site_address;
    project.budgetCents = dto.budget_cents != null ? String(dto.budget_cents) : null;
    project.sourceUpdatedAt = incoming;
    await projectRepo.save(project);
    projectsUpserted += 1;
  }

  let contactsUpserted = 0;
  for (const dto of remoteContacts) {
    const incoming = new Date(dto.updated_at);
    let contact = await contactRepo.findOne({ where: { tenantId: tenant.id, externalId: dto.id } });
    if (contact && isStale(contact.sourceUpdatedAt, incoming)) {
      continue;
    }
    if (!contact) {
      contact = contactRepo.create({ tenantId: tenant.id, externalId: dto.id });
    }
    contact.fullName = dto.fullName;
    contact.email = dto.email;
    contact.phone = dto.phone;
    contact.role = dto.role;
    if (dto.project_id) {
      const project = await projectRepo.findOne({ where: { tenantId: tenant.id, externalId: dto.project_id } });
      contact.projectId = project ? project.id : null;
    }
    contact.sourceUpdatedAt = incoming;
    await contactRepo.save(contact);
    contactsUpserted += 1;
  }

  logger.info(
    { tenantId: tenant.id, projectsUpserted, contactsUpserted },
    'tenant sync complete',
  );

  try {
    await client.reportUsage({
      account_id: tenant.buildcoAccountId,
      projects_synced: projectsUpserted,
      contacts_synced: contactsUpserted,
      synced_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err, tenantId: tenant.id }, 'usage report failed after tenant sync');
  }

  return { projectsUpserted, contactsUpserted };
}
