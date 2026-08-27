import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Van identity moves to `vans` (Task 1): a van is assigned per trip, not
  // owned by a driver.
  await db.schema.alterTable("drivers").dropColumn("van_number").execute();
  await db.schema.alterTable("drivers").dropColumn("plate").execute();

  // The real roster breaks the old enum twice: the four Iloilo drivers have no
  // shift at all, and Manila's are '11AM-11PM' / '11PM-11AM'. Phase 2's driver
  // dashboard makes shift times editable, so a typed vocabulary would cost a
  // migration per revision. Nothing branches on shift; it is only rendered.
  await sql`
    alter table drivers
      drop constraint drivers_shift_check,
      alter column shift drop not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Nullable on the way back: the van identity data is gone, so there is
  // nothing to backfill a NOT NULL with.
  await db.schema
    .alterTable("drivers")
    .addColumn("van_number", "text")
    .execute();
  await db.schema.alterTable("drivers").addColumn("plate", "text").execute();

  // Rows holding a free-text or null shift cannot satisfy the old enum, so the
  // reversal overwrites them with 'morning' rather than failing to apply — the
  // originals are gone, not cleared: an up/down/up round trip silently resets
  // the whole roster's shifts.
  await sql`
    update drivers set shift = 'morning'
      where shift is null or shift not in ('morning', 'mid', 'night')
  `.execute(db);
  await sql`
    alter table drivers
      alter column shift set not null,
      add constraint drivers_shift_check
        check (shift in ('morning', 'mid', 'night'))
  `.execute(db);
}
