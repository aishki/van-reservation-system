/**
 * Reference lists the booking form offers as choices.
 *
 * Two different kinds of data live here, and the distinction is the point:
 *
 * `TRIP_PURPOSES` is domain vocabulary — a closed set defined by the process,
 * like `RIDE_MODES`. It belongs in the codebase.
 *
 * `DEV_TOWER_HEADS` is people, which is database data. It is a marked dev
 * fixture standing in until there is a table to read, and it is the ONLY
 * hard-coded person list in the app.
 */

/**
 * Purpose options, in the business's order (not alphabetical — "Others" is
 * last). Supplied by the client 2026-08-27, replacing the six-option list.
 * Three typos in the client's supplied list were corrected here — "Copany" →
 * Company, "Saftey" → Safety, "Tracel" → Travel — and capitalisation was
 * normalised; do not "restore" the originals.
 *
 * Deliberately NOT a database CHECK constraint, unlike `site` and `status`:
 * nothing branches on purpose, it is display and reporting only, and the
 * client revises this list. A constraint would mean a migration per revision
 * for no integrity gain.
 */
export const TRIP_PURPOSES = [
  "External Affairs",
  "Finance Official Travel",
  "HR/TA Related",
  "Office Equipment / Supplies Transfer",
  "IT-Related",
  "Office Transfers",
  "Official Company Event",
  "Safety and Security-Related",
  "ER / Sent Home",
  "SLT Appointments",
  "Team Building",
  "Training-Related",
  "Travel-Related (Airport Transfers)",
  "Facilities/Admin-Related",
  "Team Lunch / Dinner / Event",
  "Asset Retrieval",
  "Onshore/Client Visit",
  "Others",
] as const;

export type TripPurpose = (typeof TRIP_PURPOSES)[number];

export function isTripPurpose(value: unknown): value is TripPurpose {
  return (
    typeof value === "string" &&
    (TRIP_PURPOSES as readonly string[]).includes(value)
  );
}

/**
 * DEV FIXTURE — replace with a query.
 *
 * Standby bookings are charged to an approving Tower Head, so this list decides
 * who can be billed. It must come from the roster before this ships: a name that
 * only exists in a TypeScript array cannot be looked up, deactivated, or
 * notified, and a leaver stays selectable forever.
 *
 * Names match the design document's own sample data so the two can be compared
 * side by side. Sorted by surname, which is how the design shows them.
 *
 * SUNSET: delete this constant when `/api/reservations/tower-heads` exists.
 * `select-tower-heads.int.test.ts` should replace `reference.test.ts`'s coverage
 * of it at the same time.
 */
export const DEV_TOWER_HEADS = [
  "Abanto, Norlyn",
  "Buenaflor, Zara",
  "Cruz, Ivan",
  "Jimera, Arielle",
] as const;
