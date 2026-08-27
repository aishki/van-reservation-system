import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Symmetric with the driver pair: a van's FIRST assignment has to stay
  // distinguishable from every later one in an append-only log, so a
  // reassignment gets its own value rather than a second `van_assigned`. No TAT
  // reads it — `first_assigned_at` is min(driver_assigned) alone.
  await sql`
    alter table reservation_events
      drop constraint reservation_events_event_type_check,
      add constraint reservation_events_event_type_check
        check (event_type in ('submitted', 'approved', 'rejected', 'cancelled',
                              'modified', 'driver_assigned', 'driver_reassigned',
                              'van_assigned', 'van_reassigned'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Rows carrying either new value cannot satisfy the narrower list, so the
  // reversal drops them — this is an append-only audit log with no
  // pre-migration equivalent to fold them into.
  await sql`
    delete from reservation_events
      where event_type in ('van_assigned', 'van_reassigned')
  `.execute(db);
  await sql`
    alter table reservation_events
      drop constraint reservation_events_event_type_check,
      add constraint reservation_events_event_type_check
        check (event_type in ('submitted', 'approved', 'rejected', 'cancelled',
                              'modified', 'driver_assigned', 'driver_reassigned'))
  `.execute(db);
}
