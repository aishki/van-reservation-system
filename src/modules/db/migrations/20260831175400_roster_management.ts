import { type Kysely, sql } from "kysely";

/**
 * Roster management: a privilege flag on the whitelist, and a log for changes
 * to the three roster tables.
 *
 * `super_admin` defaults FALSE because the column is added to a table that
 * already holds rows, and every one of them must come out non-privileged. A
 * nullable column, or one defaulting true, silently widens the permission to
 * the entire existing whitelist.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("admin_whitelist")
    .addColumn("super_admin", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();

  await db.schema
    .createTable("roster_events")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("target_table", "text", (c) => c.notNull())
    // No foreign key: this is polymorphic across three tables, which no single
    // FK can express. Safe only because roster rows are NEVER deleted —
    // deactivation is the whole of retirement — so the reference cannot dangle.
    .addColumn("target_id", "uuid", (c) => c.notNull())
    .addColumn("event_type", "text", (c) => c.notNull())
    .addColumn("actor_user_id", "uuid", (c) => c.references("users.id"))
    // NOT NULL, unlike reservation_events, which permits an all-null actor for
    // system events. Nothing generates a roster change except a person.
    .addColumn("actor_name", "text", (c) => c.notNull())
    .addColumn("actor_role", "text", (c) => c.notNull())
    .addColumn("changes", "jsonb")
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "roster_events_target_table_check",
      sql`target_table in ('drivers', 'vans', 'admin_whitelist')`,
    )
    .addCheckConstraint(
      "roster_events_event_type_check",
      sql`event_type in ('created', 'updated', 'deactivated', 'reactivated')`,
    )
    .addCheckConstraint(
      "roster_events_actor_role_check",
      sql`actor_role in ('associate', 'admin_support')`,
    )
    .execute();

  // Matches the audit page's keyset order exactly. The `id` half is required,
  // not decorative: every event written in one transaction shares a
  // `created_at`, so ordering on the timestamp alone skips or repeats rows.
  await sql`
    create index roster_events_created_id_idx
      on roster_events (created_at desc, id desc)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("roster_events").execute();
  await db.schema
    .alterTable("admin_whitelist")
    .dropColumn("super_admin")
    .execute();
}
