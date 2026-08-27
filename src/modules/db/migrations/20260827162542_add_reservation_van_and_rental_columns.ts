import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("reservations")
    .addColumn("assigned_van_id", "uuid", (c) => c.references("vans.id"))
    .addColumn("rental_driver_name", "text")
    .addColumn("rental_driver_mobile", "text")
    .addColumn("rental_van_number", "text")
    .addColumn("rental_plate", "text")
    .addColumn("rental_car_type", "text")
    .execute();

  await db.schema
    .createIndex("reservations_assigned_van_idx")
    .on("reservations")
    .column("assigned_van_id")
    .execute();

  // FR-13 widened: a trip needs a driver AND a van at approval, and each side
  // is roster OR rental, never both. App-only checks fail open the moment
  // anyone runs a manual query, so these live here too.
  await sql`
    alter table reservations
      drop constraint reservations_approved_driver_check,

      add constraint reservations_driver_source_check
        check (assigned_driver_id is null or rental_driver_name is null),
      add constraint reservations_van_source_check
        check (assigned_van_id is null or rental_plate is null),

      add constraint reservations_approved_driver_check
        check (status <> 'approved'
               or assigned_driver_id is not null
               or rental_driver_name is not null),
      add constraint reservations_approved_van_check
        check (status <> 'approved'
               or assigned_van_id is not null
               or rental_plate is not null),

      -- A rental's required fields travel together, in the style of
      -- reservations_cancellation_pair_check.
      add constraint reservations_rental_driver_pair_check
        check ((rental_driver_name is null) = (rental_driver_mobile is null)),
      add constraint reservations_rental_van_pair_check
        check ((rental_plate is null) = (rental_car_type is null)),

      -- The one genuinely optional rental field cannot outlive its identifier.
      add constraint reservations_rental_van_number_check
        check (rental_plate is not null or rental_van_number is null)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table reservations
      drop constraint reservations_rental_van_number_check,
      drop constraint reservations_rental_van_pair_check,
      drop constraint reservations_rental_driver_pair_check,
      drop constraint reservations_approved_van_check,
      drop constraint reservations_approved_driver_check,
      drop constraint reservations_van_source_check,
      drop constraint reservations_driver_source_check,

      add constraint reservations_approved_driver_check
        check (status <> 'approved' or assigned_driver_id is not null)
  `.execute(db);

  await db.schema.dropIndex("reservations_assigned_van_idx").execute();

  await db.schema
    .alterTable("reservations")
    .dropColumn("assigned_van_id")
    .dropColumn("rental_driver_name")
    .dropColumn("rental_driver_mobile")
    .dropColumn("rental_van_number")
    .dropColumn("rental_plate")
    .dropColumn("rental_car_type")
    .execute();
}
