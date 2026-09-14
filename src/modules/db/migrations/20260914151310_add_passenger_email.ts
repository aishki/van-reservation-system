import { type Kysely, sql } from "kysely";

/**
 * The booking wizard's passenger rows are switching from a Domain ID lookup to
 * plain manual entry (name + optional email) while a name-search endpoint is
 * being built upstream. `domain_id` becomes nullable rather than being dropped:
 * historical passengers already have real values there, and the eventual
 * name-search feature will populate it again. `email` is new and nullable —
 * many passengers are external clients with no corporate account at all.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("reservation_passengers")
    .alterColumn("domain_id", (c) => c.dropNotNull())
    .addColumn("email", "text")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("reservation_passengers")
    .dropColumn("email")
    .execute();

  // Cannot restore NOT NULL while any row holds a null domain_id — clear those
  // rows the same way 20260908135820 clears fields the narrower constraint
  // would otherwise reject.
  await sql`
    delete from reservation_passengers where domain_id is null
  `.execute(db);

  await db.schema
    .alterTable("reservation_passengers")
    .alterColumn("domain_id", (c) => c.setNotNull())
    .execute();
}
