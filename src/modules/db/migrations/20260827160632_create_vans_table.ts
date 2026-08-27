import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("vans")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // The client's sheet left this blank; that was the sender skipping it, not
    // an absent concept. The VAN-00N increments are the fleet's own numbering.
    .addColumn("van_number", "text", (c) => c.notNull().unique())
    // The real identifier: a plate names a physical vehicle, so two vans
    // cannot share one.
    .addColumn("plate", "text", (c) => c.notNull().unique())
    .addColumn("car_type", "text", (c) => c.notNull())
    .addColumn("site", "text", (c) => c.notNull())
    .addColumn("active", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint("vans_site_check", sql`site in ('iloilo', 'manila')`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("vans").execute();
}
