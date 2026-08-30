import { type Kysely, sql } from "kysely";

/**
 * Admits `approved_reassigned`, and widens the two approval guards to cover it.
 *
 * The guards are the point of this migration, not an afterthought. They name
 * `'approved'` as a literal, so a row at the new status satisfies neither — a
 * reassigned trip with no driver and no van would be schema-legal, which is the
 * exact condition they exist to prevent.
 *
 * Every change here WIDENS the admitted set, so `ADD CONSTRAINT`'s validation
 * pass cannot fail on existing data. Contrast `reservations_approved_van_check`
 * as originally added, whose deploy hazard is recorded in the README.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table reservations
      drop constraint reservations_status_check,
      add constraint reservations_status_check
        check (status in ('pending', 'approved', 'approved_reassigned',
                          'rejected', 'cancelled'))
  `.execute(db);

  await sql`
    alter table reservations
      drop constraint reservations_approved_driver_check,
      add constraint reservations_approved_driver_check
        check (status not in ('approved', 'approved_reassigned')
               or assigned_driver_id is not null
               or rental_driver_name is not null)
  `.execute(db);

  await sql`
    alter table reservations
      drop constraint reservations_approved_van_check,
      add constraint reservations_approved_van_check
        check (status not in ('approved', 'approved_reassigned')
               or assigned_van_id is not null
               or rental_plate is not null)
  `.execute(db);
}

/**
 * LOSSY. The narrower status constraint cannot be added while any row holds
 * `approved_reassigned`, so those rows are folded back to `approved` first and
 * the distinction is gone. Nothing else can be done: the value has no narrower
 * representation.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    update reservations set status = 'approved'
    where status = 'approved_reassigned'
  `.execute(db);

  await sql`
    alter table reservations
      drop constraint reservations_approved_van_check,
      add constraint reservations_approved_van_check
        check (status <> 'approved'
               or assigned_van_id is not null
               or rental_plate is not null)
  `.execute(db);

  await sql`
    alter table reservations
      drop constraint reservations_approved_driver_check,
      add constraint reservations_approved_driver_check
        check (status <> 'approved'
               or assigned_driver_id is not null
               or rental_driver_name is not null)
  `.execute(db);

  await sql`
    alter table reservations
      drop constraint reservations_status_check,
      add constraint reservations_status_check
        check (status in ('pending', 'approved', 'rejected', 'cancelled'))
  `.execute(db);
}
