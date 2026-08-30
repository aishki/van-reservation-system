import { type Kysely, sql } from "kysely";

/**
 * The audit log's ordering key.
 *
 * `listAuditEntries` orders by `created_at desc, id desc` across the WHOLE
 * table. `reservation_events_reservation_created_idx` leads with
 * `reservation_id`, which that query does not filter on, so it cannot serve the
 * scan.
 *
 * `id` is in the index for the same reason it is in the ORDER BY: every event
 * written in one transaction shares a `created_at`, so the timestamp alone does
 * not determine a page boundary.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createIndex("reservation_events_created_id_idx")
    .on("reservation_events")
    .expression(sql`created_at desc, id desc`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("reservation_events_created_id_idx").execute();
}
