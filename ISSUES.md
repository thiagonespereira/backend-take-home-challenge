# Code review: buildco-sync

**Submission repo (code + this review):** [github.com/thiagonespereira/backend-take-home-challenge](https://github.com/thiagonespereira/backend-take-home-challenge)

This file is the written review the brief asked for. The same repository also has an optional Critical/High implementation and [FIXES.md](FIXES.md). Git history starts from the original starter import, then the review/fix commit.

---

Review of the BuildCo → CRM integration as I would a production PR. Ranked by severity. The suite is green and the README says it runs in staging; I treated that as a signal to check what the tests do *not* cover.

I started from the README, not the tests. Two lines look like product requirements, not flavor: BuildCo external IDs are only meaningful **within a tenant**, and webhook delivery is **at-least-once** with an `occurred_at` timestamp.

---

## Critical

### 1. Webhooks are not authenticated

`POST /webhooks/buildco` only checks that `X-BuildCo-Signature` is **present**. `verifyBuildcoSignature` is never called. `express.json()` is mounted with no raw-body capture, so even wiring the helper later and HMAC-ing `JSON.stringify(req.body)` would not match BuildCo’s bytes.

The helper itself fail-closes on an empty `BUILDCO_WEBHOOK_SECRET`. Staging can only be “working” because verification is dead. The tests encode the hole: they send `sha256=abc` and expect 202.

**Impact:** Anyone who can reach the endpoint can forge project/contact writes for any account id they can guess or enumerate (unknown account currently returns 404).

**Fix:** Capture the raw Buffer in `express.json({ verify })`. Verify HMAC **before** tenant lookup or persistence. Reject 401 on missing/invalid signature. Do not canonicalize the parsed object. Add tests for valid, missing, and tampered signatures.

### 1b. Body HMAC still does not bind the tenant

The signature (as documented) covers the body only. Tenant is chosen from unsigned `X-BuildCo-Account`, and `BUILDCO_WEBHOOK_SECRET` is global. A captured valid body can be replayed under another account header.

**Impact:** Cross-tenant injection after “auth is fixed,” plus unbounded replay (no timestamp/nonce in the signature scheme we are given).

**Fix:** Confirm with BuildCo whether the account id is in the signed payload or whether we can use per-tenant secrets. Do not invent `HMAC(account + body)` on our side unless they already sign that way — we would reject real deliveries. Until then, treat the unsigned account header as residual risk.

---

## High

### 2. Update path is not tenant-scoped (asymmetric with the rest of the code)

`contact.created` resolves the parent project with `{ tenantId, externalId }`. Nightly reconcile does the same. `applyProjectUpdated` / `applyContactUpdated` use `findOne({ externalId })` only. Schema indexes `external_id` alone; there is no `UNIQUE (tenant_id, external_id)`.

**Impact:** When two tenants share an external id (explicitly allowed), a webhook for tenant A can mutate tenant B’s row. Combined with (3), `findOne` can also hit an arbitrary duplicate.

**Fix:** Always query and write with `{ tenantId, externalId }`. Add a unique constraint on that pair for both tables.

### 3. At-least-once `*.created` always inserts

Create handlers `save()` a new row every time. Embedded contacts use `payload.id ?? ''`. Retries (and overlap with nightly) duplicate records.

**Fix:** Upsert on `(tenant_id, external_id)`. Treat create and update as one apply path. Skip embedded contacts with no id.

### 4. `occurred_at` / `sourceUpdatedAt` are write-only

The column is set on every webhook and sync write and **never read**. A late event overwrites newer data and **rewinds the watermark**, so later correct events can look “older” than the stale write.

Nightly list pages can do the same to a webhook that landed after the fetch started.

**Fix:** Skip apply when the incoming timestamp is older than `sourceUpdatedAt` (webhooks and reconcile). Compare in the same transaction as the write.

### 5. `*.updated` for an unknown row is dropped

If create is lost or arrives second, the update is logged and ignored. CRM stays wrong until nightly, which can still duplicate (3).

**Fix:** Upsert on update as well.

### 6. Nightly sync is all-or-nothing

One tenant throw exits the process; remaining tenants never run. `reportUsage` runs after DB writes; if it throws, the tenant is marked failed even though data is in. Ops rerunning the job will call `/usage-report` again for tenants that already succeeded (not idempotent).

**Fix:** try/catch per tenant; continue; non-zero exit only if any failed. Treat usage reporting as best-effort. Longer term: a last-success cursor so reruns do not double-report.

### 7. Empty tenant API key falls back to the global key

`new BuildcoClient(tenant.buildcoApiKey)` uses `apiKey || config.buildco.apiKey`.

**Impact:** Syncs the wrong BuildCo account into that tenant’s CRM; usage reported under the wrong credential.

**Fix:** Fail that tenant if `buildcoApiKey` is missing. Never share keys across tenants.

---

## Medium

These are real, but I would not block the same way as the items above.

8. **BuildCo 100 req/min** is documented but not enforced. Retries on 429/5xx exist; no `Retry-After`, no fetch timeout, no client-side budget. Many tenants × pages will trip the cap.

9. **Reconcile** buffers every remote DTO, then `findOne` + `save` per row. Records deleted in BuildCo stay forever. `project_id` is only applied when truthy (webhook `contact.updated` never applies it at all), so unlinks/reassigns do not stick.

10. **`webhookRateLimit` and `securityHeaders` are dead.** The in-memory IP map would not work across instances anyway; rate-limit by account after auth, or at the edge.

11. **Ops / API shape:** `GET /healthz` does not touch Postgres. Webhook `data` is `z.record(z.unknown())`. Project + embedded contacts are not in one transaction. 404 on unknown account enumerates ids (worse while HMAC is skipped). `202` after synchronous work is slightly misleading.

---

## Low

`console.log` in reconcile instead of pino; unused `config` import on health; `timingSafeEqual` can throw on invalid hex of the same string length once verification is live; default `root:root` DB URL; no graceful shutdown; `budget_cents` as a JSON number; `isNetworkError` treats every `TypeError` as retryable. I would not pad a review with these.

---

## Tests I would add

- Valid raw-body HMAC accepted; missing or tampered signature → 401 (before tenant lookup).
- Two tenants, same `externalId`: update only the calling tenant.
- Duplicate `project.created` → one row.
- Older `occurred_at` does not clobber newer `sourceUpdatedAt` (and does not rewind the watermark).
- `project.updated` with no existing row upserts.
- Nightly: tenant 2 still runs if tenant 1 throws.
- Missing tenant API key fails that tenant; does not send the global key.

I would not treat the current suite as evidence that auth, isolation, or idempotency work.
