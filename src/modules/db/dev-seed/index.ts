import { type Kysely, sql } from "kysely";
import { instantInManila } from "@/lib/tz";
import { CANONICAL_RESERVATIONS } from "@/modules/db/dev-seed/canonical";
import { buildGeneratedReservations } from "@/modules/db/dev-seed/generated";
import {
  insertReservation,
  type ReservationSpec,
  type SeedContext,
} from "@/modules/db/dev-seed/insert";
import {
  SEED_DRIVERS,
  SEED_PEOPLE,
  SEED_VANS,
} from "@/modules/db/dev-seed/people";
import type { DB } from "@/modules/db/types";
import { SITE_TO_DB } from "@/modules/reservations/db-map";
import { nextReferenceNo } from "@/modules/reservations/reference-no";

/**
 * Loads the full dev dataset: fixture people (upserted into users — never
 * truncated, they share rows with stub logins), the driver roster, and every
 * reservation with its passengers and events. Idempotent by truncate-and-
 * reload of the domain tables; deterministic because references are issued
 * in submittedAt order from a counter this function resets.
 */
export async function seedDevDataset(db: Kysely<DB>): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "seedDevDataset loads sample data and must never run in production.",
    );
  }

  // The notification tables are listed because they reference `reservations`
  // (and each other): Postgres refuses to truncate a table another table's FK
  // points at unless every referencing table goes in the same statement.
  await sql`
    truncate table notification_outbox, notification_events,
                   reservation_events, reservation_passengers, reservations,
                   drivers, vans, reference_counters
  `.execute(db);

  const ctx: SeedContext = {
    userIds: new Map(),
    driverIds: new Map(),
    vanIds: new Map(),
  };

  for (const person of SEED_PEOPLE) {
    const row = await db
      .insertInto("users")
      .values({
        domain_id: person.domainId,
        name: person.name,
        email: person.email,
        role: person.role,
      })
      .onConflict((oc) =>
        oc.column("domain_id").doUpdateSet({
          name: person.name,
          email: person.email,
          role: person.role,
          updated_at: sql`now()`,
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();
    ctx.userIds.set(person.domainId, row.id);
  }

  for (const driver of SEED_DRIVERS) {
    const row = await db
      .insertInto("drivers")
      .values({
        name: driver.name,
        mobile: driver.mobile,
        site: SITE_TO_DB[driver.site],
        shift: driver.shift,
        active: driver.active,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    ctx.driverIds.set(driver.name, row.id);
  }

  for (const van of SEED_VANS) {
    const row = await db
      .insertInto("vans")
      .values({
        van_number: van.vanNumber,
        plate: van.plate,
        car_type: van.carType,
        site: SITE_TO_DB[van.site],
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    ctx.vanIds.set(van.vanNumber, row.id);
  }

  const specs: ReservationSpec[] = [
    ...CANONICAL_RESERVATIONS,
    ...buildGeneratedReservations(),
  ];

  // Chronological insertion so references ascend with submission time,
  // 2025 rows drawing VR-2025-… and 2026 rows VR-2026-…. A plain comparison,
  // not localeCompare: these ISO instants agree on a fixed-width prefix
  // through the seconds, so they sort correctly byte-wise, and a
  // byte-identical-across-machines guarantee must not rest on ICU collation,
  // which is locale-sensitive.
  specs.sort((a, b) =>
    a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0,
  );

  for (const spec of specs) {
    const manila = instantInManila(new Date(spec.submittedAt));
    if (manila === null) {
      throw new Error(`Seed row ${spec.key} has an invalid submittedAt`);
    }
    const year = Number(manila.date.slice(0, 4));
    const referenceNo = await nextReferenceNo(db, year);
    await insertReservation(db, ctx, spec, referenceNo);
  }
}
