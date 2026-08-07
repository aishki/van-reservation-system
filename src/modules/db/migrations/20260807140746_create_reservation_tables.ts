import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("drivers")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("mobile", "text", (c) => c.notNull())
    .addColumn("van_number", "text", (c) => c.notNull())
    .addColumn("plate", "text", (c) => c.notNull())
    .addColumn("site", "text", (c) => c.notNull())
    .addColumn("shift", "text", (c) => c.notNull())
    .addColumn("active", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint("drivers_site_check", sql`site in ('iloilo', 'manila')`)
    .addCheckConstraint(
      "drivers_shift_check",
      sql`shift in ('morning', 'mid', 'night')`,
    )
    .execute();

  await db.schema
    .createTable("reservations")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("reference_no", "text", (c) => c.notNull().unique())
    .addColumn("version", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("ride_mode", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("site", "text", (c) => c.notNull())
    .addColumn("requestor_user_id", "uuid", (c) =>
      c.notNull().references("users.id"),
    )
    .addColumn("requestor_name", "text", (c) => c.notNull())
    .addColumn("requestor_email", "text", (c) => c.notNull())
    .addColumn("requestor_mobile", "text", (c) => c.notNull())
    .addColumn("purpose", "text", (c) => c.notNull())
    .addColumn("start_at", "timestamptz", (c) => c.notNull())
    .addColumn("end_at", "timestamptz")
    .addColumn("pickup_location", "text", (c) => c.notNull())
    .addColumn("dropoff_location", "text")
    .addColumn("approving_tower_head", "text")
    .addColumn("vendor", "text")
    .addColumn("cost_php", "integer")
    .addColumn("assigned_driver_id", "uuid", (c) => c.references("drivers.id"))
    .addColumn("rejection_reason", "text")
    .addColumn("cancellation_reason", "text")
    .addColumn("cancelled_by_role", "text")
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "reservations_ride_mode_check",
      sql`ride_mode in ('pickup', 'standby')`,
    )
    .addCheckConstraint(
      "reservations_status_check",
      sql`status in ('pending', 'approved', 'rejected', 'cancelled')`,
    )
    .addCheckConstraint(
      "reservations_site_check",
      sql`site in ('iloilo', 'manila')`,
    )
    .addCheckConstraint(
      "reservations_cancelled_by_role_check",
      sql`cancelled_by_role in ('associate', 'admin_support') or cancelled_by_role is null`,
    )
    // FR-13, FR-12, FR-10 — app-only checks fail open the moment anyone runs
    // a manual query, so these live here too.
    .addCheckConstraint(
      "reservations_approved_driver_check",
      sql`status <> 'approved' or assigned_driver_id is not null`,
    )
    .addCheckConstraint(
      "reservations_rejected_reason_check",
      sql`status <> 'rejected' or rejection_reason is not null`,
    )
    .addCheckConstraint(
      "reservations_cancelled_reason_check",
      sql`status <> 'cancelled' or cancellation_reason is not null`,
    )
    .addCheckConstraint(
      "reservations_cancellation_pair_check",
      sql`(cancellation_reason is null) = (cancelled_by_role is null)`,
    )
    .addCheckConstraint(
      "reservations_time_order_check",
      sql`end_at is null or end_at > start_at`,
    )
    .addCheckConstraint(
      "reservations_mode_shape_check",
      sql`
        (ride_mode = 'pickup'
           and dropoff_location is not null and end_at is null
           and approving_tower_head is null and vendor is null and cost_php is null)
        or
        (ride_mode = 'standby'
           and end_at is not null and approving_tower_head is not null
           and dropoff_location is null)
      `,
    )
    .addCheckConstraint(
      "reservations_cost_php_check",
      sql`cost_php is null or cost_php >= 0`,
    )
    .execute();

  await db.schema
    .createIndex("reservations_site_status_start_idx")
    .on("reservations")
    .columns(["site", "status", "start_at"])
    .execute();
  await sql`
    create index reservations_requestor_created_idx
      on reservations (requestor_user_id, created_at desc)
  `.execute(db);
  await db.schema
    .createIndex("reservations_assigned_driver_idx")
    .on("reservations")
    .column("assigned_driver_id")
    .execute();

  await db.schema
    .createTable("reservation_passengers")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("reservation_id", "uuid", (c) =>
      c.notNull().references("reservations.id").onDelete("cascade"),
    )
    .addColumn("domain_id", "text", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("position", "integer", (c) => c.notNull())
    .addUniqueConstraint("reservation_passengers_position_unique", [
      "reservation_id",
      "position",
    ])
    .execute();

  await db.schema
    .createIndex("reservation_passengers_reservation_idx")
    .on("reservation_passengers")
    .column("reservation_id")
    .execute();

  await db.schema
    .createTable("reservation_events")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("reservation_id", "uuid", (c) =>
      c.notNull().references("reservations.id").onDelete("cascade"),
    )
    .addColumn("actor_user_id", "uuid", (c) => c.references("users.id"))
    .addColumn("actor_name", "text")
    .addColumn("actor_role", "text")
    .addColumn("event_type", "text", (c) => c.notNull())
    .addColumn("remark", "text")
    .addColumn("changes", "jsonb")
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "reservation_events_event_type_check",
      sql`event_type in ('submitted', 'approved', 'rejected', 'cancelled',
                         'modified', 'driver_assigned', 'driver_reassigned')`,
    )
    .addCheckConstraint(
      "reservation_events_actor_role_check",
      sql`actor_role in ('associate', 'admin_support') or actor_role is null`,
    )
    // All-null actor means a system event; a human actor carries name AND role.
    .addCheckConstraint(
      "reservation_events_actor_check",
      sql`
        (actor_user_id is null and actor_name is null and actor_role is null)
        or (actor_name is not null and actor_role is not null)
      `,
    )
    .execute();

  await db.schema
    .createIndex("reservation_events_reservation_created_idx")
    .on("reservation_events")
    .columns(["reservation_id", "created_at"])
    .execute();

  await db.schema
    .createTable("reference_counters")
    .addColumn("year", "integer", (c) => c.primaryKey())
    .addColumn("next_value", "integer", (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("reference_counters").execute();
  await db.schema.dropTable("reservation_events").execute();
  await db.schema.dropTable("reservation_passengers").execute();
  await db.schema.dropTable("reservations").execute();
  await db.schema.dropTable("drivers").execute();
}
