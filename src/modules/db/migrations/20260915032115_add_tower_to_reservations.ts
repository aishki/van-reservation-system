import type { Kysely } from "kysely";

/**
 * Which business unit a trip's passengers belong to. Nullable, not NOT NULL:
 * every reservation submitted before this ships genuinely has no answer for
 * it — there is nothing honest to backfill — while `draft.ts`'s validation
 * and `wire.ts`'s schema both require a real value on every NEW submission,
 * the same nullable-in-the-database / required-by-the-app split already used
 * for `reservation_passengers.email`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("reservations")
    .addColumn("tower", "text")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("reservations").dropColumn("tower").execute();
}
