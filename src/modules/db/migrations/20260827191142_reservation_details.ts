import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Nullable, then backfilled, then tightened: a NOT NULL column cannot simply
  // appear over existing rows. The backfill states what is true rather than
  // inventing a purpose for a booking nobody described.
  await db.schema
    .alterTable("reservations")
    .addColumn("details", "text")
    .execute();

  await sql`
    update reservations
       set details = 'No detail recorded (booked before this field existed).'
     where details is null
  `.execute(db);

  // btrim, not <> '': three spaces satisfy a naive check and reach an admin
  // as blank context — the same trap `validateDecision` trims for.
  await sql`
    alter table reservations
      alter column details set not null,
      add constraint reservations_details_check check (btrim(details) <> '')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("reservations").dropColumn("details").execute();
}
