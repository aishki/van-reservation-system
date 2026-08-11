# Architecture

How the code is laid out, and the conventions that hold it together.

For *what the software does* — statuses, roles, TAT, the whitelist rules —
see [domain.md](domain.md). For running it, [setup.md](setup.md). For
deploying it, [operations.md](operations.md).

---

## 1. At a glance

A Next.js App Router application over Postgres, with no ORM. Server components
read through repository functions and pass data into client components, which
use TanStack Query for subsequent refetch and mutation. Business rules live in
pure functions that never touch I/O; SQL lives in repositories that take a
Kysely instance.

Two external services sit behind interfaces with two implementations each — a
stub for development and the real thing for production. Nothing upstream knows
which is in use.

---

## 2. Stack

| | |
|---|---|
| Framework | Next.js 16.2.12, App Router, Turbopack |
| Language | TypeScript, React 19.2.4 |
| Database | Postgres 17, **Kysely** — typed query builder, raw SQL where clearer. No ORM |
| Schema types | `kysely-codegen` generates `src/modules/db/types.d.ts`. Never hand-edited |
| Validation | zod v4, in `wire.ts` files at the request boundary |
| Auth | HS256 JWT via `jose`, in an httpOnly cookie |
| Email | AWS SES v2 (`@aws-sdk/client-sesv2`), templates in React Email |
| Styling | Tailwind v4 — CSS-first, no JS config |
| Components | shadcn/ui on **Base UI** (not Radix), `base-nova` style |
| Data fetching | TanStack Query v5 |
| Charts | Recharts, wrapped by `ui/chart.tsx` |
| Animation | `motion` (Framer Motion's successor) |
| Icons | `lucide-react` — a deliberate substitution for missing Figma icon exports |
| Tests | Vitest, unit and integration in separate configs |
| Lint/format | Biome 2.2.0. No ESLint, no Prettier |

---

## 3. Layering

```
src/app        →  src/modules, src/lib, src/components
src/components →  src/modules, src/lib
src/modules    →  src/modules/db, src/lib
```

Nothing lower reaches upward. Two things are worth knowing about how this is
enforced:

**No lint rule enforces it.** There is no path-scoped override in `biome.json`
restricting `next/*` imports from `src/lib` or `src/modules`. The boundary is
convention, verified by inspection — and in practice it holds: `src/lib` has
zero `next` imports, and `src/modules` has exactly one, `auth/service.ts`,
whose `getSessionUser()` deliberately needs `next/headers`.

**`src/middleware.ts` reads the JWT directly** rather than calling
`getSessionUser()`. It runs on the edge runtime, which cannot load Kysely or
`pg`, so it calls `readSessionToken` and nothing that would pull a repository
into the edge bundle. This constraint is why the file must not become
`proxy.ts` by rename — see [operations.md §7](operations.md#7-known-hazards).

### The three kinds of file inside `modules/`

| Kind | Contract | Examples |
|---|---|---|
| **Pure rules** | No I/O, no React, no `next/*` | `auth/roles.ts`, `reservations/decision.ts`, `reservations/types.ts`, `drivers/workload.ts`, `roster/types.ts`, `audit/changes.ts` |
| **Repository** | Takes `Kysely<DB>` or `Transaction<DB>`, owns SQL | `auth/repo.ts`, `admins/repo.ts`, `reservations/repo.ts`, `reservations/write.ts`, `roster/events.ts` |
| **Service** | Orchestrates the two above | `auth/service.ts`, `email/service.ts`, `email/dispatch.ts` |

Pure-rule files are the ones worth reading first. They are where the domain
lives, and they are trivially testable.

---

## 4. Directory structure

```
src/
  app/
    (admin)/       dashboard, master-list, calendar, reports,
                   drivers, audit-logs, roster          — 7 pages
    (auth)/        login, admin/login, not-authorized   — 3 pages
    (requestor)/   /, book, manage                      — 3 pages
    api/           route handlers (see §7)
    globals.css    the entire design token contract
    providers.tsx  QueryClientProvider, TooltipProvider, Toaster
  components/      65 non-test files across 6 directories (see §9)
  hooks/
  lib/             env, result, api-error, db-url, tz, utils
  modules/         9 domain modules (see §5)
  middleware.ts    the edge route gate
test/              integration harness
```

---

## 5. Modules

| Module | Responsibility | Entry points |
|---|---|---|
| **`auth`** | Identity, roles, sessions, the provider seam | `authenticate`, `getSessionUser`, `requireUser`, `requireAdmin`, `resolveRole`, `resolveSuperAdmin`, `selectAuthProvider` |
| **`db`** | Kysely client, generated types, migrations, seeds | `createDb`, `getDb` |
| **`reservations`** | The booking domain — the largest module | `listReservations`, `write.ts` transitions, `decision.ts` rules, `calendar.ts`, `dashboard-metrics.ts`, `export.ts` |
| **`admins`** | CRUD over `admin_whitelist`, plus the four guardrails | `listAdmins`, `isSuperAdmin`, `createAdmin`, `updateAdmin`, `setAdminActive` |
| **`drivers`** | Driver roster and weekly workload | `listDrivers`, `createDriver`, `updateDriver`, `setDriverActive`, `WEEKLY_HOURS_CAP` |
| **`vans`** | Van roster. Structurally identical to `drivers` | `listVans`, `createVan`, `updateVan`, `setVanActive` |
| **`roster`** | Shared roster machinery for the three above | `recordRosterEvent`, `diffFields`, `wire.ts` schemas, `affectedTrips` |
| **`audit`** | Read-only views over the two event trails | `listAuditEntries`, `listRosterEvents`, `parseChanges` |
| **`email`** | Outbound mail: transports, templates, the outbox dispatcher | `sendEmail`, `dispatchOutbox`, `adminRecipients`, `selectMailTransport` |

`admins`, `drivers`, and `vans` are three near-identical create/patch/setActive
modules, **deliberately not generalised.** Only `admins` needs guardrails —
there is no single-point-of-failure capability at stake in a driver or a van —
and collapsing them would put those guardrails behind an abstraction that the
other two would have to opt out of.

`db` imports nothing from other modules at runtime. The exceptions are all
non-runtime: the `seeds/` and `dev-seed/` scripts import `auth` and
`reservations` types for fixture realism, and this module's own
`*.int.test.ts` files import from `auth`, `reservations` and `roster` to assert
against real constraints.

---

## 6. Data layer

`createDb(connectionString)` builds a `Kysely<DB>` over a `pg` Pool capped at
10 connections. `getDb()` caches one instance keyed off `env().DATABASE_URL`.

### Tables

Eleven tables. Two of them are append-only event logs, and the distinction
between them matters:

| Table | Holds |
|---|---|
| `users` | One row per person who has signed in |
| `admin_whitelist` | Who may hold `admin_support`; the `super_admin` flag; per-site notification routing |
| `drivers` | Driver roster. No longer holds van identity |
| `vans` | Van roster — `van_number`, `plate` (unique), `car_type`, `site`, `active` |
| `reservations` | One row per trip. Wide: mode, status, site, requestor snapshot, purpose, timing, locations, cost, driver-or-rental, van-or-rental, reasons, `version` |
| `reservation_passengers` | Named seats, unique per reservation and position |
| `reservation_events` | **Append-only trail of reservation writes.** Permits a null actor for system events |
| `roster_events` | **Append-only trail of roster writes.** Polymorphic over `drivers`/`vans`/`admin_whitelist`. `actor_name` and `actor_role` are NOT NULL — a person always causes a roster change — though the `actor_user_id` FK itself is nullable |
| `notification_events` | One row per notifiable event; the in-app spine |
| `notification_outbox` | The email queue — one row per outbound message |
| `reference_counters` | Per-year counter behind `VR-2026-000412` reference numbers |

> **There is no `audit_log` table.** The admin action log on `/audit-logs` is a
> *view over `reservation_events`*, filtered to `actor_role = 'admin_support'`.
> A second log would be a second thing to keep in sync. `roster_events` is a
> real, separate table because it has a different shape — polymorphic target,
> non-nullable actor.

### Migrations

Thirteen, in order. Each row names the constraint or column it introduced, so
a schema question can be traced back to the migration that caused it.

| # | Migration | Did |
|---|---|---|
| 1 | `create_auth_tables` | `users`, `admin_whitelist`; site check, identity check, unique `lower(email)` |
| 2 | `identity_hardening` | Unique `lower(domain_id)` on users; whitelist email index becomes `lower(trim(email))`, closing a whitespace-duplicate hole |
| 3 | `create_reservation_tables` | `drivers` (with van columns, later removed), `reservations` with its full CHECK set, `reservation_passengers`, `reservation_events`, `reference_counters` |
| 4 | `create_notification_tables` | `notification_events`, `notification_outbox` with `sent ⇔ (sent_at ∧ provider_message_id)` |
| 5 | `create_vans_table` | `vans` as its own table |
| 6 | `add_reservation_van_and_rental_columns` | `assigned_van_id` + five `rental_*` columns; roster-or-rental exclusivity CHECKs for both sides |
| 7 | `split_van_from_drivers` | **Drops `van_number`/`plate` from `drivers`.** Makes `shift` nullable and drops its 3-value CHECK |
| 8 | `add_van_assignment_events` | Admits `van_assigned` / `van_reassigned` event types |
| 9 | `reservation_details` | `reservations.details`, NOT NULL with a non-blank CHECK, backfilled |
| 10 | `remap_retired_purposes` | Data-only: five retired purpose strings → replacements. `down()` is an intentional no-op |
| 11 | `add_reassigned_status` | Admits `approved_reassigned`, widens the approval CHECKs |
| 12 | `audit_log_index` | `(created_at desc, id desc)` on `reservation_events` — the existing `reservation_id`-leading index cannot serve a whole-table keyset scan |
| 13 | `roster_management` | `admin_whitelist.super_admin` (default **false**, so no existing row is silently granted it); `roster_events`; a matching keyset index |

Migration 6's constraints are the ones most likely to block a deploy against
real data. See [operations.md §3](operations.md#3-migrations-and-seeds).

### Trips and rentals

**One `reservations` row is one trip.** There is no parent booking table; a
wizard submission inserts up to `MAX_TRIPS_PER_SUBMISSION` (10) rows, each with
its own reference number.

Two ride modes, enforced by `reservations_mode_shape_check`:

- **`pickup`** — point to point. Has a dropoff location; no `end_at`, tower
  head, vendor, or cost.
- **`standby`** — holds a van and driver for a block. Requires `end_at` and an
  approving tower head; no dropoff location.

A trip's driver and van are each **either** a roster reference **or** a
one-off rental typed in at approval time, never both. Modelled as
discriminated unions in code (`source: "roster" | "rental"`) and as
mutually-exclusive CHECK constraints in the database. See
[domain.md §7](domain.md#7-vans-drivers-and-rentals).

---

## 7. API and error handling

### Routes

| Path | Methods |
|---|---|
| `/api/auth/login` · `/logout` | POST |
| `/api/auth/session` | GET |
| `/api/auth/verify-domain` | POST |
| `/api/associates/lookup` | POST |
| `/api/reservations` | GET, POST |
| `/api/reservations/[id]` | GET, PATCH |
| `/api/reservations/[id]/cancel` | POST |
| `/api/drivers` · `/api/vans` · `/api/admins` | GET, POST |
| `/api/drivers/[id]` · `/api/vans/[id]` · `/api/admins/[id]` | PATCH |
| `/api/drivers/[id]/affected` · `/api/vans/[id]/affected` | GET |
| `/api/audit-logs` | GET |
| `/api/internal/dispatch-outbox` | GET |
| `/api/dev/email` · `/[template]` · `/probe` | GET |

**One PATCH per resource handles both a field edit and an activation change.**
Splitting them would put one resource's state behind two URLs. The two cases
are distinguished by trying two `.strict()` schemas in sequence, so a body
mixing both matches neither and 422s.

`/api/internal/dispatch-outbox` is guarded by a shared secret header, not
session auth — it is called by a scheduler, and it is excluded from the
middleware matcher along with the rest of `/api`.

`/api/dev/*` routes 404 in production.

### The error model

`Result<T, E>` in `src/lib/result.ts` — `{ok: true, value}` or
`{ok: false, error}`. Repositories and rules return it; route handlers convert.

`src/lib/api-error.ts` maps error codes to status:

| Code | Status |
|---|---|
| `VALIDATION_FAILED`, `DRIVER_REQUIRED`, `EMAIL_REJECTED` | 422 |
| `INVALID_TRANSITION`, `VERSION_CONFLICT` | 409 |
| `NOT_AUTHENTICATED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `RATE_LIMITED` | 429 |
| `SERVICE_UNAVAILABLE` | 503 |

All ten codes in `ERROR_STATUS`. The last three are provider-facing:
`SERVICE_UNAVAILABLE` and `RATE_LIMITED` come from the upstream auth provider
or SES, and `EMAIL_REJECTED` marks a permanently refused message — see
[email.md §8](email.md#8-failures-and-retries).

`errorResponse(code, message, details?)` emits
`{ error: { code, message, details? } }` at the mapped status.

Module error types are `Extract`ed from that map rather than declared
separately, so removing a code breaks compilation at every consumer instead of
letting the two drift. `EmailFailure` and `AuthFailure` both work this way.

### Wire schemas

Three `wire.ts` files — `reservations/`, `roster/`, `audit/` — own zod parsing
for their module's bodies and query params, kept separate from the pure rules
so a structural error ("wrong shape") stays distinguishable from a
business-rule error.

**`roster/wire.ts`'s PATCH and activation schemas are `.strict()`; its three
create schemas are not.** Without `.strict()` zod strips unknown keys silently,
so a body with a typo'd field name half-applies — which is why the patch paths
have it (`driverPatchSchema:47`, `activeSchema:62`, `vanPatchSchema:75`,
`adminPatchSchema:133`) and why `driverCreateSchema`, `vanCreateSchema` and
`adminCreateSchema` arguably should. PATCH schemas additionally refuse an empty
object, so an empty patch cannot write a no-op `updated` audit event.

---

## 8. Auth

### The provider seam

`AuthProvider` has three methods: `identify`, `verifyDomain`, and
`lookupName(domainId)`. Two implementations — `StubAuthProvider` for
development, `CgsAuthProvider` for the real CGS Associate Authentication API —
selected by `AUTH_MODE`. Nothing upstream of the interface knows which is live.

`lookupName` deliberately returns only `{name}`, never contact details, because
it backs the booking wizard's passenger autofill and must not disclose other
associates' information.

### Sign-in

`authenticate()` takes a `portal` of `"requestor"` or `"admin"`. **There is no
separate admission allowlist** — the CGS directory authenticates only active
employees, so a successful `identify` *is* the admission check.
`admin_whitelist` decides capability, and only at the admin door. See
[domain.md §2](domain.md#2-roles) for the full resolution order.

A refused admin attempt fails **before** `upsertUser` runs, so it leaves no
`last_login_at` trace.

### Sessions

`vr_session`, an HS256 JWT via `jose`, httpOnly, with a required `exp` claim.
`SESSION_TTL_SECONDS` is 8 hours.

The payload carries `superAdmin`, which **defaults to `false` on parse** so
that cookies signed before the field existed still validate. Without that
default, adding the field would have signed out every logged-in user on deploy.

### Two enforcement points

1. **`src/middleware.ts`** — edge, page navigation only. `resolveRedirect` is a
   pure function, unit-tested. `ADMIN_PREFIXES` covers all seven admin routes.
2. **`requireUser()` / `requireAdmin()`** — Node runtime, called explicitly by
   every route handler, because `/api/*` is excluded from the middleware
   matcher.

`requireAdmin()` is an explicit allowlist on the literal string
`"admin_support"`, so a future third role is denied by default.

### Capability is re-read, never trusted from the cookie

`SessionUser.superAdmin` is documented as **cosmetic. Nothing authorizes on it,
and nothing reads it.**

A capability baked into a signed cookie lags the database in *both* directions:
it survives a revocation, and it misses a grant. Trusting it produced a real
bug during development — a freshly promoted holder saw the Admins tab (because
the page does its own database read) and got a 403 on every write behind it,
for the life of the cookie.

So every consumer re-reads: `isSuperAdmin(db, identity)` →
`resolveSuperAdmin(identity, await listActiveWhitelist(db))`. The
`/api/admins` gate does it per request. `/api/audit-logs` does it to decide
whether whitelist-target entries are visible. `/roster`'s page does it rather
than reading `user.superAdmin`.

`isSuperAdmin` matches on the **full identity** — Domain ID *and* email.
Matching on Domain ID alone previously reopened a self-lockout hole.

---

## 9. Frontend

### Rendering model

**Every page is a server component.** All 13 pages across the three route
groups; zero carry `"use client"`. They fetch through repositories directly and
pass results as props into client views.

Of the 81 files in `src/components/`, 43 are client components — forms,
drawers, dialogs, charts, the animated login van. The pattern is a server shell
with client leaves: `login-hero.tsx` stays on the server so its wedge and
gradient ship no JavaScript, and only its child `login-van.tsx` is a client
component.

TanStack Query is configured with `staleTime: 30_000`,
`refetchOnWindowFocus: false`, and **mutations are never retried** — replaying
an approve or a cancel is worse than surfacing the failure. It is used in nine
components; query keys are centralised per module.

### Every page checks its own session — deliberately

There is **no `layout.tsx` in any route group.** Every admin and requestor page
repeats its own `getSessionUser()` and redirect, each with a comment saying
why:

> A layout does not re-execute on client-side navigation between sibling
> routes, so a layout-only check would be a fail-open.

This is a convention, not duplication to be cleaned up. A new admin page must
copy the block.

### The token contract

Tailwind v4 has no JS config. Every token is declared in
`src/app/globals.css` inside `@theme`.

| Group | Tokens |
|---|---|
| Brand | `brand` `#5009b5`, `primary` `#7142ff`, `navy`, `plum` |
| Requestor | `requestor-text-accent`, `requestor-blob-highlight`, `requestor-field-line`, `requestor-field-line-strong` |
| Admin | `admin-accent` `#00650a`, `admin-panel`, `admin-heading`, `admin-blob-highlight` |
| Hero | `hero-glow`, `hero-base`, `hero-deep`, `hero-accent`, `hero-shadow`, `hero-scrim` |
| Surfaces | `brand-tint`, `brand-wash`, `site-iloilo-tint/-ink`, `site-manila-tint/-ink` |
| Grey / state | `gray-1`…`gray-6`, `error`, `success`, `error-tint`, `error-tint-border`, `success-tint` |
| Type | `--font-sans`; `--text-h1/h2/h3/body/sm/xs`, `--text-display` (5.25rem, requestor hero only) |
| Radii | `pill` 9999px, `field` 0.5rem, `card` 1rem |

Two further layers sit on top: a shadcn semantic layer inside `@theme`, and a
bare `:root` alias layer of 20 entries feeding `color-mix()` and inline `style`
props.

`--color-border` and `--color-input` map to **`gray-3`, not `gray-4`** —
`gray-4` is 1.6:1 and fails WCAG 1.4.11's 3:1 minimum for component
boundaries.

### The design is light-only, and one line enforces that

```css
@custom-variant dark (&:is(.dark *));
```

The generated shadcn primitives ship `dark:` utilities. No `.dark` class is
ever rendered, and this line is the only thing preventing an OS in dark mode
from applying them.

**It must stay after all three `@import`s** — CSS requires imports to precede
other at-rules, and Biome's `noInvalidPositionAtImportRule` will flag it
otherwise. Do not move it, and do not add `dark:` variants.

### Verifying a token is live — grep is not enough

Three separate mechanisms make a token look present while doing nothing:

1. **Pruning.** Tailwind emits `@theme` custom-property *declarations* whether
   used or not, but generates the **utility-class selector** only if something
   references it. `--text-h2: 3rem` is in the compiled CSS while `.text-h2{…}`
   is not. The declaration is not proof.
2. **Baking.** A hand-written `color-mix()` inside a custom `@utility` gets
   fully evaluated by Lightning CSS when its inputs are static, compiling to a
   flat literal with no `var()` left. Editing the token then changes nothing.
   Prefer Tailwind's alpha modifier (`to-hero-scrim/72`).
3. **twMerge dropping.** `cn()` is plain `twMerge(clsx(…))` with no
   `extendTailwindMerge` config, so tailwind-merge does not know this project's
   custom font-size tokens and classifies them by suffix as text *colours*.
   `cn("text-body", "text-gray-1")` silently drops `text-body`.

So: `rm -rf .next && pnpm build`, then grep the compiled CSS for the
**selector** (`.bg-admin-accent{`), not the declaration. And for case 3, check
the rendered HTML — the class is in the CSS file, it just never reaches the
element.

> **A declared token is not a used token.** `--color-admin-text-accent` is
> declared, contrast-documented, and referenced nowhere. `grep -rn <token> src/`
> before trusting any comment about where it "ships".

### Variant theming

Admin and requestor surfaces differ through modules of **literal** Tailwind
class-string constants — never assembled at runtime, so Tailwind's scanner can
see them. `login-theme.ts` keys an accent record by variant;
`admin-theme.ts` and `requestor-theme.ts` hold per-surface strings.

The requestor variant uses the `hero-*` gradients; admin uses flat
`bg-admin-panel` and `bg-admin-accent`, because no admin gradient design
exists to transcribe.

`FOCUS_RING` is project-wide rather than per-variant, because the Figma design
draws no focus state on any screen — a WCAG 2.4.7 gap closed in code.

### Components

Counts are non-test files; they sum to the 65 in §4.

| Directory | Files | Contents |
|---|---|---|
| `ui/` | 7 | Base UI primitives: `button`, `card`, `chart`, `input`, `label`, `sonner`, `tooltip` |
| `auth/` | 8 | `login-form`, `login-hero`, `login-van` (Motion drive-in, reduce-motion aware), `domain-id-input` (7-box, fieldset + per-box labels), `password-field`, `sign-out-button` |
| `shells/` | 2 | `requestor-shell`; `admin-shell` — 256px sticky sidebar, topbar, working area |
| `common/` | 4 | `hint`, `rental-tag`, `row-menu`, `status-chip` — shared across both surfaces |
| `admin/` | 25 | `admin-nav`, `admin-topbar`, plus `audit/`, `calendar/`, `dashboard/`, `drivers/`, `master-list/`, `reports/`, `roster/`, `trip-drawer/` |
| `requestor/` | 19 | `hero-*`, `home-view`, `manage/`, and the 4-step `wizard/` |

Notable pieces: `roster/roster-view.tsx` (three tabs, all four forms have
paired tests), `audit/audit-view.tsx` (cursor-paginated via
`useInfiniteQuery`), `trip-drawer/` (the per-reservation approve/decide panel,
with a `useTripDrawer()` host consumed by the master list).

**The topbar bell is deliberately inert** — `unreadCount` is hardcoded to `0`
and clicking it toasts "Notifications aren't wired up yet."

### Dates and times go through one file

`src/lib/tz.ts` is the only place in the codebase permitted to format a date or
time, **enforced by a drift-guard test** that scans `src/` for
`toLocaleDateString`, `toLocaleTimeString`, `toLocaleString`, and
`Intl.DateTimeFormat` outside that file.

---

## 10. Conventions that must not regress

Most of these exist because their absence caused a real bug; the rest are
preventive. The second column names what actually stops a regression — and is
honest where the answer is nothing.

| Convention | Enforced by |
|---|---|
| Roster events are written in the transaction that made the change | `recordRosterEvent` takes `Transaction<DB>`, never `Kysely<DB>` — the type system |
| Every page checks its own session | Convention plus a comment on each page. No route-group layout exists to regress into |
| Date formatting lives in `tz.ts` | A drift-guard test that greps `src/` |
| Roster PATCH bodies reject unknown keys | `.strict()` on the patch and activation schemas in `roster/wire.ts`. **The three create schemas lack it** — unknown keys on a POST are stripped, not rejected |
| Guardrails cannot be routed around | They live inside the repo layer, inside the transaction |
| `super_admin` is never read from the cookie | The cookie field has zero readers; every consumer calls `isSuperAdmin` |
| The design stays light-only | `@custom-variant dark` + Biome's import-position rule |
| Error codes cannot drift from HTTP status | Module failure types are `Extract`ed from `ERROR_STATUS` |
| No `next/*` in `src/lib` | **Nothing.** Convention only — a lint rule would be worth adding |

---

## See also

- [domain.md](domain.md) — the business rules
- [setup.md](setup.md) — local development
- [operations.md](operations.md) — environment, deploy, runbook
- [email.md](email.md) — the notification pipeline and the templates
