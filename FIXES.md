# Critical / High fixes

Companion to [ISSUES.md](ISSUES.md). That file is the review (what I would flag, including Medium/Low). This file is only what was implemented: Critical and High. Medium and Low were left unfixed on purpose.

Verify: `npm test` (unit). Live path below was run against Docker Postgres + the Node process on port 3000.

---

## Live run (local, not mocked)

There is no real BuildCo API (`BUILDCO_BASE_URL` defaults to `https://api.buildco.example.com/v1`, which does not resolve). The service also has no tenant-registration endpoint. To exercise the HTTP path for real we stood up Postgres, seeded tenants (the missing “account” side of the fake host), and sent signed webhooks as BuildCo would.

**Stack**

- Docker Desktop Postgres 16 (`docker compose up -d`), `DATABASE_URL=postgres://root:root@localhost:5432/buildco_sync`
- `.env`: `BUILDCO_WEBHOOK_SECRET=local-dev-webhook-secret` (empty secret fail-closes HMAC)
- `npm run migration:run` — initial schema + unique `(tenant_id, external_id)`
- `npx ts-node src/index.ts` listening on `:3000`

**Injected tenants** (stand-in for BuildCo accounts the nightly job would otherwise fetch):

```sql
INSERT INTO tenants (name, buildco_account_id, buildco_api_key)
VALUES
  ('Acme Construction', 'acct-100', 'key-100'),
  ('Other Co', 'acct-200', 'key-200');
```

HMAC is SHA-256 of the **raw JSON body** with that webhook secret, header `X-BuildCo-Signature: sha256=<hex>`. Tenant is `X-BuildCo-Account`.

**HTTP results**

| Request | Status | Notes |
|---|---|---|
| `GET /healthz` | 200 | `{ "status": "ok" }` |
| `POST /webhooks/buildco` no signature | 401 | `invalid signature` |
| same, `sha256=abc` | 401 | before tenant lookup |
| signed `project.created` `bc-proj-1` as `acct-100` | 202 | Riverside Tower |
| same create again (at-least-once) | 202 | still one row |
| signed stale `project.updated` (`occurred_at` 2024-06-17) | 202 | did not overwrite |
| signed newer `project.updated` (`occurred_at` 2024-06-19) | 202 | Phase 2 / `on_hold` |
| signed `project.created` same `bc-proj-1` as `acct-200` | 202 | Other Tower, other tenant |
| signed `project.updated` `bc-proj-new` with no existing row | 202 | Harbor Works inserted |

**Postgres after those calls**

| account | external_id | name | status | source_updated_at |
|---|---|---|---|---|
| acct-100 | bc-proj-1 | Riverside Tower Phase 2 | on_hold | 2024-06-19 08:00:00Z |
| acct-100 | bc-proj-new | Harbor Works | active | 2024-06-20 00:00:00Z |
| acct-200 | bc-proj-1 | Other Tower | active | 2024-06-18 09:30:00Z |

**Nightly vs the fake host:** `npx ts-node src/jobs/nightlySync.ts` cannot list/sync from BuildCo (`getaddrinfo ENOTFOUND api.buildco.example.com`). Both seeded tenants failed independently; the job still walked the full tenant list and exited non-zero. Webhook rows above were unchanged. That is as far as nightly can be proven without a stub BuildCo server.

---

## Critical 1 — Webhook HMAC was never verified

**Problem:** The route checked that `X-BuildCo-Signature` existed. `verifyBuildcoSignature` was unused. Tests sent `sha256=abc` and got 202.

**Change:**
- [`src/app.ts`](src/app.ts) — `express.json({ verify })` stores the raw request Buffer.
- [`src/routes/webhooks.ts`](src/routes/webhooks.ts) — verify HMAC first; 401 on missing/invalid; then account header, parse, tenant, process.
- [`src/utils/webhookSignature.ts`](src/utils/webhookSignature.ts) — invalid hex of the same length returns `false` instead of throwing from `timingSafeEqual`.

**Tests:** [`test/webhooks.test.ts`](test/webhooks.test.ts), [`test/webhookSignature.test.ts`](test/webhookSignature.test.ts)

We did **not** HMAC `account + body`. BuildCo’s documented scheme is body-only. Cross-tenant replay via unsigned `X-BuildCo-Account` remains in ISSUES.md (Critical 1b).

---

## High 2 — Updates ignored tenant

**Problem:** `project.updated` / `contact.updated` used `findOne({ externalId })`. Create and nightly already scoped by tenant.

**Change:**
- [`src/services/eventService.ts`](src/services/eventService.ts) — every lookup is `{ tenantId, externalId }`.
- [`src/entities/Project.ts`](src/entities/Project.ts), [`src/entities/Contact.ts`](src/entities/Contact.ts) — `@Unique(['tenantId', 'externalId'])`.
- [`src/migrations/1718700000001-TenantExternalUnique.ts`](src/migrations/1718700000001-TenantExternalUnique.ts) — unique indexes (initial migration left as-is).

---

## High 3 — At-least-once creates duplicated rows

**Problem:** `*.created` always inserted. Embedded contacts with no id stored `externalId: ''`.

**Change:** Create and update share one upsert. Embedded contacts without `id` are skipped.

---

## High 4 — `occurred_at` / `sourceUpdatedAt` were write-only

**Problem:** Late events overwrote newer data and rewound the watermark.

**Change:** Skip apply when incoming time is older than `sourceUpdatedAt` in event processing and [`src/services/reconcileService.ts`](src/services/reconcileService.ts). Stale events do not write.

---

## High 5 — Unknown `*.updated` was dropped

**Problem:** Update before create (or a lost create) was logged and ignored.

**Change:** Missing rows are inserted on update (same upsert as create).

---

## High 6 — Nightly fail-fast; usage report failed the tenant

**Problem:** One tenant throw skipped the rest. `reportUsage` after DB writes could fail a successful sync. Job reruns can still double-report (called out in ISSUES.md; no last-success cursor added).

**Change:**
- [`src/jobs/nightlySync.ts`](src/jobs/nightlySync.ts) — `syncAllTenants()` try/catch per tenant; `process.exitCode = 1` only if any failed.
- Reconcile: usage report errors are logged; `syncTenant` still returns success after upserts.

---

## High 7 — Empty tenant key fell back to the global API key

**Problem:** `apiKey || config.buildco.apiKey` could sync the wrong BuildCo account into a tenant.

**Change:** [`src/clients/buildco.ts`](src/clients/buildco.ts) throws if `apiKey` is missing. No global fallback.

---

## Not implemented (see ISSUES.md)

BuildCo 100 req/min limiter, fetch timeouts, pagination/N+1 rewrite, remote deletes, `project_id` unlinks, wiring `webhookRateLimit` / `securityHeaders`, DB-aware healthz, payload schema tightening, transactions around embedded contacts.
