import { type Kysely, sql } from "kysely";

/**
 * The notification spine, and the email channel that hangs off it.
 *
 * In-app notifications and emails fire on the SAME six transitions. Recording
 * them as two independent mechanisms would mean two sets of triggers in
 * `write.ts`, drifting apart the first time an event is added — so one
 * `notification_events` row is written per event, and channels fan out from it.
 */

/** The six transitions a requestor is notified about. */
const EVENTS = [
  "submitted",
  "approved",
  "rejected",
  "cancelled",
  "driver_assigned",
  "driver_changed",
];

export async function up(db: Kysely<unknown>): Promise<void> {
  // The spine — and ALSO the in-app notification: `recipient_user_id`, `title`,
  // `body`, `link` and `read_at` are the whole of that channel, because all six
  // events target exactly one user. An event needing several in-app recipients
  // (a future admin digest) wants a join table; deliberately not built until one
  // exists.
  await db.schema
    .createTable("notification_events")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // Nullable: the submitted digest is about a submission, not one row.
    .addColumn("reservation_id", "uuid", (c) =>
      c.references("reservations.id").onDelete("cascade"),
    )
    .addColumn("event", "text", (c) => c.notNull())
    // Nullable: an event whose only channel is email has no in-app recipient
    // (the admin new-request notice goes to addresses, not to app users).
    .addColumn("recipient_user_id", "uuid", (c) =>
      c.references("users.id").onDelete("cascade"),
    )
    // Compact, for the bell list — NOT the email card. An in-app row needs a
    // line of text and somewhere to go, so it stores that and nothing more.
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("body", "text", (c) => c.notNull())
    /** Where clicking lands, e.g. `/manage?ref=VR-1042`. */
    .addColumn("link", "text", (c) => c.notNull())
    .addColumn("read_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "notification_events_event_check",
      sql`event in (${sql.join(EVENTS.map((event) => sql.lit(event)))})`,
    )
    .execute();

  // The bell's two queries: the newest N for a user, and the unread count.
  await sql`
    create index notification_events_recipient_idx
      on notification_events (recipient_user_id, created_at desc)
      where recipient_user_id is not null
  `.execute(db);

  await sql`
    create index notification_events_unread_idx
      on notification_events (recipient_user_id)
      where recipient_user_id is not null and read_at is null
  `.execute(db);

  // The email channel. One row per MESSAGE, so an event that mails the requestor
  // and the admins separately is two rows pointing at one event.
  await db.schema
    .createTable("notification_outbox")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // NOT NULL: a queued message without the event that caused it is
    // unexplainable, and cascade means neither can outlive the other.
    .addColumn("event_id", "uuid", (c) =>
      c.references("notification_events.id").onDelete("cascade").notNull(),
    )
    .addColumn("template", "text", (c) => c.notNull())
    .addColumn("recipient", "text", (c) => c.notNull())
    // Copied recipients. A delimited text column would force an
    // address-escaping convention; this is read back for auditing, not searched.
    .addColumn("cc", "jsonb", (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    // The template's input, pre-formatted at enqueue time. Snapshotted, never
    // recomputed: a dispatcher that re-read the reservation would describe a
    // since-edited trip.
    .addColumn("payload", "jsonb", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
    .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("next_attempt_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("last_error", "text")
    .addColumn("provider_message_id", "text")
    .addColumn("sent_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "notification_outbox_status_check",
      sql`status in ('pending', 'sending', 'sent', 'failed')`,
    )
    // A sent row has both a time and a provider id; an unsent row has neither.
    // Same all-or-nothing shape as reservation_events' actor check.
    .addCheckConstraint(
      "notification_outbox_sent_check",
      sql`(status = 'sent') = (sent_at is not null and provider_message_id is not null)`,
    )
    .execute();

  // The dispatcher's only query. Partial, because 'sent' rows are the vast
  // majority and never appear in it.
  await sql`
    create index notification_outbox_due_idx
      on notification_outbox (next_attempt_at)
      where status = 'pending'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("notification_outbox").execute();
  await db.schema.dropTable("notification_events").execute();
}
