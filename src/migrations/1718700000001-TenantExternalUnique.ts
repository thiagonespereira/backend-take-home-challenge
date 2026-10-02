import { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantExternalUnique1718700000001 implements MigrationInterface {
  name = 'TenantExternalUnique1718700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_projects_tenant_external"
      ON "projects" ("tenant_id", "external_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_contacts_tenant_external"
      ON "contacts" ("tenant_id", "external_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_contacts_tenant_external"`);
    await queryRunner.query(`DROP INDEX "uq_projects_tenant_external"`);
  }
}
