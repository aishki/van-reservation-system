# Van Reservation System

Internal web application for reserving and managing company van transportation
at Carelon Global Solutions PH. Replaces the temporary Nintex-based process.

An associate books a van for a trip. An admin approves or rejects it, assigning
a driver and a van. Everyone involved gets email, and every admin action is
recorded in an audit trail.

## Requirements

Node 20+, pnpm, and Docker (optional — any Postgres 13+ works; see
[docs/setup.md §7](docs/setup.md#7-using-a-database-you-dont-own)).

## Getting started

`.env.example` deliberately ships every unsafe value in the state that
**fails**, not the state that works — a verbatim copy will not boot. One
variable must be set in your own untracked `.env`:

```bash
cp .env.example .env

# Required — the app throws at startup while this is empty:
#   SESSION_SECRET=$(openssl rand -base64 48)

pnpm install
pnpm db:up          # Postgres 17 on port 5433
pnpm db:migrate
pnpm db:codegen     # regenerate src/modules/db/types.d.ts
pnpm db:seed        # admin whitelist + client fleet
pnpm db:seed:dev    # sample reservations — every page renders real data
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

**Signing in.** Stub auth accepts any password; the Domain ID selects the
identity.

| Domain ID | Sign in at | You get |
|---|---|---|
| `AM65108` | `/login` | A requestor holding most of the sample bookings |
| `AG80389` | `/admin/login` | An admin, and a `super_admin` who can manage the roster |
| `AB12345` | `/login` | A requestor with nothing — the empty state |

**The door decides the role, not the whitelist.** `/login` always issues an
`associate` session, so `AM65108` gives a genuine requestor view even though
that Domain ID is also a whitelisted admin — sign the same ID in at
`/admin/login` to get the admin side. Full identity list in
[docs/setup.md §4](docs/setup.md#4-signing-in).

`pnpm test:int` creates its own test database the first time it runs, then
migrates it. No manual `createdb`.

For the full setup path, every stub identity, and the traps —
**[docs/setup.md](docs/setup.md)**.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Development server |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm format` | Biome |
| `pnpm test` | Unit tests, no database |
| `pnpm test:int` | Integration tests, requires Postgres |
| `pnpm db:migrate` / `db:migrate:make <name>` | Run / scaffold migrations |
| `pnpm db:codegen` | Regenerate schema types after a migration |
| `pnpm db:seed` | Prod-safe: admin whitelist + fleet roster |
| `pnpm db:seed:dev` | Dev sample dataset; refuses to run in production |
| `pnpm db:up` / `pnpm db:down` | Local Postgres container |

## Documentation

| | |
|---|---|
| **[setup.md](docs/setup.md)** | Local development — prerequisites, first run, test accounts, running the suites, the things that will confuse you |
| **[architecture.md](docs/architecture.md)** | Layering, the 9 modules, the data layer and all 13 migrations, the API and error model, auth, the frontend and design tokens |
| **[domain.md](docs/domain.md)** | The business rules — roles, the admin whitelist and its guardrails, reservation lifecycle, TAT and SLA, purposes, vans and rentals, the audit trail |
| **[operations.md](docs/operations.md)** | Environment variables, SES and the session-token trap, migration and seed ordering, the outbox sweeper, monitoring, production readiness |
| **[email.md](docs/email.md)** | Email and notifications — the outbox pipeline, the four templates, the transport seam, failure handling, dev previews and the probe |

Design specs and implementation plans live under `docs/superpowers/` and are
deliberately not committed — they are working artifacts, not documentation.

## Stack

Next.js 16 (App Router) · TypeScript · Postgres 17 with Kysely, no ORM · zod ·
TanStack Query · Tailwind v4 · shadcn/ui on Base UI · AWS SES with React Email
· Vitest · Biome

## Before production

There is a readiness checklist in
**[operations.md §6](docs/operations.md#6-production-readiness)**. The items most likely to bite:

- **`EMAIL_MODE` must be set to `ses`.** The stub queues, renders, and marks
  every message `sent` while delivering nothing. It produces no error signal at
  all.
- **`DISPATCH_SECRET` plus a scheduler**, or mail queued during a provider
  outage never retries on its own.
- **`pnpm db:migrate` before `pnpm db:seed`**, and `db:seed` must run in every
  environment or nobody can manage the admin whitelist.
- **Roles lag revocation by up to 8 hours** — they ride in the session JWT.
- **`src/middleware.ts` must not become `proxy.ts` by rename.** The rename
  shipped in Next 16.0.0 and this repo is on 16.2.12, so the codemod applies
  today — it is not a future-upgrade concern. `proxy` is Node-only and cannot be
  configured for edge; `middleware` runs on the edge runtime, and that is what
  keeps Kysely out of the auth gate.
