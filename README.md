# buildco-sync

**Submission.** Start here: **[ISSUES.md](ISSUES.md)** — ranked written review (the brief). Optional Critical/High implementation and a live Postgres/webhook run: **[FIXES.md](FIXES.md)**. Repo: [github.com/thiagonespereira/backend-take-home-challenge](https://github.com/thiagonespereira/backend-take-home-challenge).

---

Integration service that syncs Projects and Contacts from the BuildCo construction API into the CRM's Postgres database. The service is multi-tenant: each tenant connects their own BuildCo account, so BuildCo external IDs are only meaningful within a tenant.

The service passes all tests and runs in staging.

## Code review exercise

This repository is part of a hiring exercise. Review the codebase as you would a real production PR: identify correctness, reliability, security, and maintainability issues, explain their impact, and propose concrete fixes.

Submit your findings as a written review to the hiring manager, annotated PR, or similar. Rank issues by severity and note any tests you would add.

## What it does

- **Webhook ingestion** — `POST /webhooks/buildco` receives `project.created`, `project.updated`, `contact.created`, and `contact.updated` events from BuildCo and applies them to the local database. The tenant is resolved from the `X-BuildCo-Account` header, which carries the BuildCo account ID the tenant registered with.
- **Nightly reconciliation** — `node dist/jobs/nightlySync.js` pages through BuildCo's `GET /projects` and `GET /contacts` endpoints for every tenant and reconciles all records into the database. Run it from cron or a scheduler once per day.
- **Health check** — `GET /healthz` for load balancer probes.

### Webhook endpoint

`POST /webhooks/buildco`

| Header | Description |
| --- | --- |
| `X-BuildCo-Account` | BuildCo account ID for the tenant |
| `X-BuildCo-Signature` | request signature |

Delivery: at-least-once. Events carry an `occurred_at` timestamp.

## Setup

Requirements: Node.js 20+, Docker.

```bash
docker compose up -d          # start Postgres
cp .env.example .env          # fill in BuildCo credentials
npm install
npm run migration:run
npm run dev                   # or: npm run build && npm start
```

Run the test suite:

```bash
npm test
```

Run the nightly sync manually:

```bash
npm run build
node dist/jobs/nightlySync.js
```

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `3000` |
| `DATABASE_URL` | Postgres connection string | local docker-compose instance |
| `BUILDCO_BASE_URL` | BuildCo API base URL | `https://api.buildco.example.com/v1` |
| `BUILDCO_API_KEY` | Default BuildCo API key | empty |
| `BUILDCO_WEBHOOK_SECRET` | Secret used to sign webhook deliveries | empty |
| `LOG_LEVEL` | pino log level | `info` |

Each tenant row also stores its own `buildco_api_key`, which the nightly sync uses when calling the API on that tenant's behalf.

## BuildCo API

- Rate limit: 100 requests/minute
- Pagination: list endpoints return up to 100 items per page with a `has_more` flag.

## Event payloads

```json
{
  "id": "bc-proj-8841",
  "type": "project.updated",
  "occurred_at": "2024-06-18T09:30:00Z",
  "data": {
    "name": "Riverside Tower",
    "projectStatus": "on_hold",
    "site_address": "12 Quay St",
    "budget_cents": 480000000
  }
}
```

`project.created` events may include an embedded `contacts` array, which the service stores alongside the project.

## Bonus: tools that help day-to-day

Optional — not part of the exercise scoring. If you use AI-assisted development (Cursor, Copilot, etc.), these are worth setting up on any project:

**Cursor rules** (`.cursor/rules/` or project rules): short, always-on instructions for the agent — stack conventions, "never commit unless asked", "match existing patterns", test expectations. Rules beat repeating yourself in every chat.

**Skills** (`SKILL.md` files): reusable playbooks for recurring tasks — "create a PR", "run CI triage", "add a migration". Good for workflows you do weekly but don't want to re-explain.

**Useful habits in chat:**
- Point the agent at the README and domain docs before asking it to review or implement.
- Ask for a plan before large changes; ask for a minimal diff for fixes.
- `@`-mention specific files or folders instead of "the webhook code".
- After a fix, ask what tests are missing — don't assume green tests mean the bug class is covered.

**Shell / repo hygiene:** `docker compose up -d`, run migrations before the app, `npm test` before submitting. Keep `.env` out of git.

If you already use rules or skills you find effective, mention them in your submission — we're interested in how you work, not just what you find.
