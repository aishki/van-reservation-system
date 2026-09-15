import { type Kysely, sql } from "kysely";

/**
 * Admits `no_show`: an approved trip whose driver and van showed up but whose
 * passenger did not. Distinct from `cancelled` (withdrawn before the fact) and
 * from `rejected` (never approved) — the fleet commitment genuinely happened,
 * which is why the two approval guards below admit it alongside `approved`
 * and `approved_reassigned` rather than leaving it unconstrained: a no-show
 * row with no driver and no van would be schema-legal otherwise, the same
 * hole `20260830060413_add_reassigned_status.ts` closed for the reassigned
 * spelling.
 *
 * Reversible, unlike every other terminal status: an admin can revert a
 * no-show back to `approved` if the passenger turns up late. That transition
 * writes a new `reservation_events` value (`no_show_reverted`) rather than a
 * second `approved`, so the audit log can tell "first approved" apart from
 * "un-no-showed" — the same reasoning `driver_assigned`/`driver_reassigned`
 * follow for the assignment side.
 *
 * `notification_events_event_check` is widened too: a no-show mail (and its
 * reversal) uses the same spine as the other six requestor-facing events.
 *
 * Every change here WIDENS an admitted set, so `ADD CONSTRAINT`'s validation
 * pass cannot fail on existing data.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table reservations
      drop constraint reservations_status_check,
      add constraint reservations_status_check
        check (status in ('pending', 'approved', 'approved_reassigned',
                          'no_show', 'rejected', 'cancelled'))
  `.execute(db);

  await sql`
    alter table reservations
      drop constraint reservations_approved_driver_check,
      add constraint reservations_approved_driver_check
        check (status not in ('approved', 'approved_reassigned', 'no_show')
               or assigned_driver_id is not null
               or rental_driver_name is not null)
  `.execute(db);

  await sql`
    alter table reservations
      drop constraint reservations_approved_van_check,
      add constraint reservations_approved_van_check
        check (status not in ('approved', 'approved_reassigned', 'no_show')
               or assigned_van_id is not null
               or rental_plate is not null)
  `.execute(db);

  await sql`
    alter table reservation_events
      drop constraint reservation_events_event_type_check,
      add constraint reservation_events_event_type_check
        check (event_type in ('submitted', 'approved', 'rejected', 'cancelled',
                              'modified', 'driver_assigned', 'driver_reassigned',
                              'van_assigned', 'van_reassigned',
                              'no_show', 'no_show_reverted'))
  `.execute(db);

  await sql`
    alter table notification_events
      drop constraint notification_events_event_check,
      add constraint notification_events_event_check
        check (event in ('submitted', 'approved', 'rejected', 'cancelled',
                         'driver_assigned', 'driver_changed',
                         'no_show', 'no_show_reverted'))
  `.execute(db);
}

/**
 * LOSSY, same shape as `20260830060413_add_reassigned_status.ts`'s reversal.
 * A no-show row is folded back to `approved` — the status it would have held
 * had this migration never landed — before the narrower constraint can be
 * re-added; `no_show`/`no_show_reverted` events are dropped from the
 * append-only logs since neither has a pre-migration equivalent to fold into.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    update reservations set status = 'approved' where status = 'no_show'
  `.execute(db);

  await sql`
    delete from reservation_events
      where event_type in ('no_show', 'no_show_reverted')
  `.execute(db);
  await sql`
    delete from notification_events
      where event in ('no_show', 'no_show_reverted')
  `.execute(db);

  await sql`
    alter table notification_events
      drop constraint notification_events_event_check,
      add constraint notification_events_event_check
        check (event in ('submitted', 'approved', 'rejected', 'cancelled',
                         'driver_assigned', 'driver_changed'))
  `.execute(db);

  await sql`
    alter table reservation_events
      drop constraint reservation_events_event_type_check,
      add constraint reservation_events_event_type_check
        check (event_type in ('submitted', 'approved', 'rejected', 'cancelled',
                              'modified', 'driver_assigned', 'driver_reassigned',
                              'van_assigned', 'van_reassigned'))
  `.execute(db);

  await sql`
    alter table reservations
      drop constraint reservations_approved_van_check,
      add constraint reservations_approved_van_check
        check (status not in ('approved', 'approved_reassigned')
               or assigned_van_id is not null
               or rental_plate is not null)
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
      drop constraint reservations_status_check,
      add constraint reservations_status_check
        check (status in ('pending', 'approved', 'approved_reassigned',
                          'rejected', 'cancelled'))
  `.execute(db);
}
