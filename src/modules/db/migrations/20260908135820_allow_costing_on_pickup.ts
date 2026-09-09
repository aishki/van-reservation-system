import { type Kysely, sql } from "kysely";

/**
 * Lets Admin Support record a vendor and a cost on a pickup/drop-off request,
 * not just a standby one. The Costing section in the Trip Details drawer used
 * to render only for standby because this CHECK forbade `vendor`/`cost_php` on
 * any other mode — a UI gate mirroring a schema gate, both removed together.
 *
 * `approving_tower_head` stays pickup-forbidden: that field is the requestor's
 * own submission from the standby wizard step, unrelated to this change.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table reservations
      drop constraint reservations_mode_shape_check,
      add constraint reservations_mode_shape_check
        check (
          (ride_mode = 'pickup'
             and dropoff_location is not null and end_at is null
             and approving_tower_head is null)
          or
          (ride_mode = 'standby'
             and end_at is not null and approving_tower_head is not null
             and dropoff_location is null)
        )
  `.execute(db);
}

/**
 * LOSSY. The narrower constraint cannot be added back while any pickup row
 * holds a vendor or a cost, so those values are cleared first.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    update reservations
      set vendor = null, cost_php = null
      where ride_mode = 'pickup'
  `.execute(db);

  await sql`
    alter table reservations
      drop constraint reservations_mode_shape_check,
      add constraint reservations_mode_shape_check
        check (
          (ride_mode = 'pickup'
             and dropoff_location is not null and end_at is null
             and approving_tower_head is null and vendor is null and cost_php is null)
          or
          (ride_mode = 'standby'
             and end_at is not null and approving_tower_head is not null
             and dropoff_location is null)
        )
  `.execute(db);
}
