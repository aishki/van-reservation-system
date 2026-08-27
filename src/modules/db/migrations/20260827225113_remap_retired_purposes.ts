import { type Kysely, sql } from "kysely";

/**
 * Remaps purposes retired by the 2026-08-27 vocabulary change (see
 * `TRIP_PURPOSES` in `reference.ts`) to their replacements. Pre-branch rows
 * can still hold a retired value; left alone, `isTripPurpose` rejects the
 * whole trip on any edit that runs `applyTripEdit` over it, even one that
 * only touches the pickup point.
 *
 * Updates zero rows on a freshly seeded database — the seed only ever wrote
 * new-vocabulary purposes. It is still required before this ships against
 * real data, where every one of these five retired values is in use.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const remap: Record<string, string> = {
    "Airport Transfer": "Travel-Related (Airport Transfers)",
    "Finance - Official Travel": "Finance Official Travel",
    "HR-Related": "HR/TA Related",
    "IT-related": "IT-Related",
    "Official Business-related": "Others",
  };

  for (const [from, to] of Object.entries(remap)) {
    await sql`
      update reservations set purpose = ${to} where purpose = ${from}
    `.execute(db);
  }
}

/**
 * No-op. `Official Business-related` collapses into `Others`, which also
 * holds trips that were genuinely booked as `Others` — the two are no longer
 * distinguishable, so there is no faithful reverse for that leg of the
 * mapping. Reversing the other four while leaving that one mapped forward
 * would silently misrepresent this migration as fully undone.
 */
export async function down(): Promise<void> {}
