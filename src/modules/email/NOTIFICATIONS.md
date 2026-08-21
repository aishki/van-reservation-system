# Wiring email to the reservation write path

> **THIS WAS THE PLAN. THE WORK IS DONE.** Notifications shipped in PR #2 and are live in
> `reservations/notify.ts`, `email/dispatch.ts`, the three write routes' `after()` hooks
> and `GET /api/internal/dispatch-outbox`. Read this file for the REASONING — the
> transaction ordering, the claim-before-send rule, the permanent-versus-transient split
> — all of which still hold and are still the point.
>
> Where it no longer matches the code:
>
> - It plans one table, `notification_outbox`. The implementation also has
>   `notification_events`, an in-app feed (title, body, link, recipient, `read_at`), and
>   moved `cc` onto the queue row.
> - It plans five templates including separate rejection and cancellation ones. The
>   implementation has four: `booking-status-change` covers approved, rejected and
>   cancelled with the status as a payload field, because those three differ only in
>   copy. `driver-assignment` is separate because a driver or van change is NOT a status
>   change — the reservation stays approved.
> - §2's enqueue table predates the van/driver split. `driver_assigned`/`driver_changed`
>   now fire on a van change too, and the copy speaks of the *assignment* rather than the
>   driver. The stored event names were deliberately left alone; see the comment at the
>   `event:` line in `write.ts`.
> - §8's warning about `sendEmail` rejecting an empty field is still live and was hit for
>   real: `trip.details` became required and is now `.catch(EM_DASH)` so a pre-deploy
>   outbox row cannot be stranded permanently.
>
> Do not use this file as a task list. Use it to understand why the shape is what it is.

## The rule that decides the design

**An email provider outage must not fail a booking.**

The tempting version is one line in `submitBooking`:

```ts
await sendBookingStatusChange(transport, actor.email, input); // don't
```

That puts an HTTP call to Amazon inside a database transaction. SES times out, the
`await` rejects, the transaction rolls back, and a requestor who filled in a four-step
wizard is told their booking failed — because a confirmation email didn't send. Moving
the call after the commit only trades that for the opposite bug: the row exists and the
email is lost with no record that it was owed.

So the send is **queued in the same transaction as the write, and delivered separately**.
The queue row commits or rolls back with the reservation, atomically; delivery is a later,
retryable step whose failure is visible.

## 1. Migration — `notification_outbox`

Follow `20260807140746_create_reservation_tables.ts` for style: Kysely schema builder,
named CHECK constraints, explicit indexes.

```ts
await db.schema
  .createTable("notification_outbox")
  .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
  // Nullable: an admin digest is not about one reservation. ON DELETE CASCADE so a
  // deleted reservation cannot strand a queued message about it.
  .addColumn("reservation_id", "uuid", (c) =>
    c.references("reservations.id").onDelete("cascade"),
  )
  .addColumn("template", "text", (c) => c.notNull())
  .addColumn("recipient", "text", (c) => c.notNull())
  // Copied recipients, as a jsonb array. A plain text column would force a
  // delimiter convention on addresses, and the question this column exists to
  // answer after the fact — "who else got this?" — is unanswerable without it.
  .addColumn("cc", "jsonb", (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
  // The template's input, pre-formatted at enqueue time. See §3.
  .addColumn("payload", "jsonb", (c) => c.notNull())
  .addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
  .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
  .addColumn("next_attempt_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
  .addColumn("last_error", "text")
  .addColumn("provider_message_id", "text")
  .addColumn("sent_at", "timestamptz")
  .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
  .addCheckConstraint(
    "notification_outbox_status_check",
    sql`status in ('pending', 'sending', 'sent', 'failed')`,
  )
  // A sent row has both a time and a provider id; an unsent row has neither. Same
  // all-or-nothing shape as reservation_events' actor check.
  .addCheckConstraint(
    "notification_outbox_sent_check",
    sql`(status = 'sent') = (sent_at is not null and provider_message_id is not null)`,
  )
  .execute();

// The dispatcher's only query. Partial, because 'sent' rows are the vast majority
// and never appear in it.
await sql`
  create index notification_outbox_due_idx
    on notification_outbox (next_attempt_at)
    where status = 'pending'
`.execute(db);
```

Then `pnpm db:migrate && pnpm db:codegen` — the generated types in `src/modules/db/types.d.ts`
are what the repo code compiles against, and codegen leaves every enum column a plain
`string`, so `status` needs no cast.

## 2. Where to enqueue

Three call sites, all in `src/modules/reservations/write.ts`, all **inside the existing
`db.transaction().execute()` block** — that placement is the entire mechanism:

| Function | Template | Recipient |
| --- | --- | --- |
| `submitBooking` | `booking-submitted` | To: `actor.email`, **once per submission** — see below |
| `submitBooking` | `admin-new-request` | To: `adminRecipients(db, site)`, once per submission |
| `decideReservation` (approve/reject) | `booking-status-change` | To: the row's `requestor_email`; **Cc: `adminRecipients`** |
| `decideReservation` (van/driver set or changed) | `driver-assignment` | To: the row's `requestor_email`; **Cc: `adminRecipients`** |
| `cancelReservation` | `booking-status-change` | To: whichever party did NOT act |

Every one of these also carries `EMAIL_ALWAYS_CC` (see `env.ts`), applied in
`sendEmail` rather than at any enqueue site above — so the standing copy is a
property of sending a message, not something each row has to remember. It is NOT
written to the queue row's `cc`, which stays the record of who the *decision*
copied; deduped against the To and Cc so the standing recipient, who is likely
also one of the site's admins, is not copied twice.

**Where "who got this" is answerable.** Three places, and they must agree:

1. **The queue row** — `recipient` + `cc`, written at enqueue time and never recomputed.
   This is the durable record; a dispatcher that re-derived recipients at send time would
   mail whoever the whitelist says *today* about a decision made last week.
2. **`StubTransport`'s log line** in development — `→ <to> · cc: <a, b> · <subject>`.
3. **`/api/dev/email`** — the preview's To/Cc strip, resolved from `ADMIN_WHITELIST_SEED`
   through `selectAdminEmails`, the same function the live path uses. It shows the RULE
   applied to seed data, not what any real send did.

Recipients are resolved by `adminRecipients` in `recipients.ts` — active, `notify`,
and `site in (booking's site, 'all')`, name-ordered, email-less rows dropped. That is the
ONE place the routing rule lives; the templates render the same body for everyone and know
nothing about who receives it. `EmailMessage.cc` carries the copied admins (SES
`CcAddresses`), and `StubTransport` prints them so the dev log answers "who else got
this".

Add a single helper in a new `src/modules/reservations/notify.ts` so the three sites stay
one line each:

```ts
export async function enqueueNotification(
  trx: Transaction<DB>,
  entry: {
    reservationId: string | null;
    template: string;
    recipient: string;
    cc?: string[];
    payload: unknown;
  },
): Promise<void>
```

`submitBooking` already selects nothing back after its insert — it has `row.id` and the
draft, which is everything the payload needs. `decideReservation` and `cancelReservation`
both already fetch the row, but **neither selects `requestor_email` today**; add it to
their `.select([...])` lists.

**One digest per submission, not one mail per trip.** A `BookingDraft` carries
`trips: TripDraft[]`, and `submitBooking` writes one reservation per trip, each with its own
reference. Enqueuing beside each `submitted` event would therefore drop four near-identical
mails into a requestor's inbox within a second of each other for a four-trip submission. So
this one enqueue goes **after** the trip loop, still inside the same transaction, with a
payload carrying every reference:

```ts
enqueueNotification(trx, {
  reservationId: null,          // the column is nullable for exactly this case
  template: "booking-submitted",
  recipient: actor.email,
  payload: { site, rideMode, requestor, manageUrl, trips: [...] },
});
```

`templates/booking-submitted.tsx` already renders 1..N trips and is unit-tested; only the
enqueue is missing. The decision mails stay **per reservation** — approval, rejection and
cancellation are per-trip outcomes, and a submission's trips can and do diverge (two
approved, one rejected). Grouping those would mean holding a mail back until every trip in
the submission had been decided, which delays the news for no benefit.

Note this is the one enqueue whose `reservation_id` is null, so it does not inherit the
`ON DELETE CASCADE` the other three get. That is acceptable because reservations are never
deleted — cancellation is a status — but a future hard-delete would strand these rows.

**Admin notifications** are template #2, `admin-new-request`, and they are a SECOND enqueue
in `submitBooking` — one row addressed to `adminRecipients(db, site)`, also once per
submission rather than once per trip. `notify` and `site` on `admin_whitelist` are what
that query reads.

## 3. Payload — pre-format at enqueue time

`RequestInformationInput` is deliberately all display strings, and its docblock says why:
an email has no timezone, so a `timestamptz` rendered in the wrong one shows the wrong day.

Two consequences:

- **Format with `lib/tz.ts` helpers only.** `tz.test.ts` has a drift guard that walks all
  of `src/` and fails if any other file formats a date or touches `Intl.DateTimeFormat`.
  `write.ts` already imports from `lib/tz`; use `formatPlainDate` / `formatPlainTime` /
  `formatInstant` and nothing else.
- **Snapshot, don't re-read.** Storing the formatted payload means the mail says what was
  true when the event happened. A dispatcher that re-read the reservation would send an
  "approved" notice describing a trip that has since been edited.

`manageUrl` comes from `env().APP_URL` — already in `lib/env.ts`, defaulting to
`http://localhost:3000`.

## 4. Templates

Four exist and are unit-tested: `booking-submitted.tsx` (#1, requestor),
`admin-new-request.tsx` (#2, admins), `booking-status-change.tsx` (#3 — Approved, Rejected
and Cancelled in ONE template, since they differ only by a heading, a sentence and whether
there is a reason to quote) and `driver-assignment.tsx` (#4, first assignment or a change).
All four are the same three parts: `shell.tsx` for the envelope, their own copy,
and `request-information.tsx` for the booking itself — a card stack mirroring
`step-review.tsx` so the mail reads like the screen the requestor just confirmed.

**An assignment change is not a status change.** The reservation stays Approved, which is
why it has its own template rather than a fourth branch of `booking-status-change` — and why
the `decision: null` path in `decideReservation` must compare the old and new assignment on
BOTH sides instead of treating every field edit as silent. Van and driver are assigned
independently, so the notice fires when either moves and its copy names neither; the stored
event values `driver_assigned` / `driver_changed` keep their older spelling.

Driver details live on the TRIP (`RequestDriver`), not the submission: a three-date standby
block can be covered by three people, and the same driver may take a different unit on a
different day, so `plate` belongs to the assignment rather than the person.

Any further template composes `EmailShell` + `RequestInformation`, imports the shared
`templates/styles.ts` rather than declaring a `styles` object, and keeps the "caller
formats, template lays out" contract.

Add each new template to `templates/fixtures.ts` at the same time — that is what the
dev-only preview at `/api/dev/email` lists, and it is the cheapest way to look at a
template's HTML *and* its plain-text half without sending anything.

Register them in one map so the dispatcher can look a row's `template` up:

```ts
// src/modules/email/templates/index.ts
export const TEMPLATES = {
  "booking-submitted": renderBookingSubmitted,
  "admin-new-request": renderAdminNewRequest,
  "booking-status-change": renderBookingStatusChange,
  "driver-assignment": renderDriverAssignment,
  "booking-rejected": renderBookingRejected,
  "booking-cancelled": renderBookingCancelled,
} as const;
```

An unknown `template` value must fail the row as **permanent** (§5), not retry forever.

## 5. The dispatcher

New file `src/modules/email/dispatch.ts`. One exported function, no scheduling logic of
its own:

```ts
export async function dispatchOutbox(
  db: Kysely<DB>,
  transport: MailTransport,
  limit = 25,
): Promise<{ sent: number; failed: number; retrying: number }>
```

**Claim rows before sending**, so two running instances cannot send the same mail twice:

```sql
update notification_outbox set status = 'sending', attempts = attempts + 1
where id in (
  select id from notification_outbox
  where status = 'pending' and next_attempt_at <= now()
  order by created_at
  for update skip locked
  limit $1
)
returning *
```

`for update skip locked` is the load-bearing clause. Without it, a second dispatcher
blocks on the same rows and then sends them again.

Then per row: render via `TEMPLATES[row.template]`, call `sendEmail(transport, …)`, and map
the result. `EmailFailure` already draws the line you need — do not collapse it:

| Result | Row becomes |
| --- | --- |
| `ok` | `sent`, with `sent_at` and `provider_message_id` |
| `EMAIL_REJECTED` | `failed` — permanent. Retrying an unverified sender or a bad address never succeeds |
| `VALIDATION_FAILED` | `failed` — a programming error; retrying replays the bug |
| `SERVICE_UNAVAILABLE` | `pending`, `next_attempt_at = now() + backoff(attempts)` |
| `RATE_LIMITED` | same, with a longer floor |
| a thrown error | `pending` with backoff — an unknown failure is assumed transient |

Backoff: `min(2 ** attempts, 60) minutes`. Give up at, say, `attempts >= 8` by marking
`failed` — a row stuck in `sending` because the process died is the reason `attempts` is
incremented at claim time rather than after the send.

## 6. What runs it

`selectMailTransport(env())` builds the transport; it returns the no-send `StubTransport`
unless `EMAIL_MODE=ses`, and `env.ts`'s superRefine already refuses to boot with
`EMAIL_MODE=ses` and incomplete `AWS_*` credentials. Nothing more to configure.

Two triggers, and you want both:

1. **After the response.** Next 16 exports `after` from `next/server`, which runs work once
   the response is flushed. In `POST /api/reservations`, the cancel route and the PATCH:
   `after(() => dispatchOutbox(getDb(), transport))`. Mail goes out in seconds and the
   requestor never waits for it. A failure here is already recorded in the row.
2. **A sweeper**, because trigger 1 misses anything enqueued while the provider was down.
   A `GET /api/internal/dispatch-outbox` guarded by a shared secret header, called by any
   scheduler, or a `pnpm` script run by cron. Idempotent by construction — the claim query
   is the lock.

Do not put the dispatcher in `middleware.ts`: `/api/*` is outside the matcher by design,
and the edge runtime cannot load Kysely.

## 7. Tests

- **`dispatch.int.test.ts`** — against the real database, with a fake `MailTransport` that
  returns each `EmailFailure` in turn. Cover: a claimed row is not re-claimed; a permanent
  failure never retries; a transient one comes back due after its backoff; the sent-check
  constraint rejects a half-written `sent` row.
- **`write.int.test.ts`** — extend it: a successful submit leaves exactly one queued row
  per trip, and a submit that rolls back (the existing "later trip fails" test) leaves
  **zero**. That second assertion is the one that proves the atomicity claim.
- **Row cleanup is a hard gate.** Every `*.int.test.ts` here runs against one shared
  database with `fileParallelism: false`, so a suite that leaks rows breaks a *later*
  suite while still passing itself. This has happened four times on this project. Any new
  int test needs an `afterAll` deleting its rows in FK-safe order — `notification_outbox`
  before `reservations` — and must pass `pnpm test:int` **run twice in a row**.

## 8. Two things that will bite

- **`sendEmail` validates structurally and returns `VALIDATION_FAILED` for an empty
  recipient, subject, or body.** A template that renders an empty string for a missing
  payload field therefore fails the row permanently, silently, with no mail and no
  exception. Validate the payload shape at *enqueue* time.
- **`StubTransport`'s constructor throws in production.** That is intentional — a deploy
  that forgets `EMAIL_MODE=ses` fails loudly rather than dropping mail forever. But it
  throws when `selectMailTransport` builds it, which is inside the dispatcher, so the
  queued rows just stay `pending` and retry. That is the right outcome and nothing will
  alert you to it. Watch the count of `pending` rows older than an hour.
