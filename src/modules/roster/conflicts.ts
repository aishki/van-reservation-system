import type { Kysely } from "kysely";
import { instantFromManila, instantInManila } from "@/lib/tz";
import type { DB } from "@/modules/db/types";
import { STATUS_TO_DB } from "@/modules/reservations/db-map";
import { SCHEDULED_STATUSES } from "@/modules/reservations/types";

/**
 * Trips that would be left with an inactive assignee.
 *
 * Deactivating a driver or van does NOT unassign anything — those trips keep
 * their assignee and stay valid. This exists so the operator sees the
 * consequence before confirming, rather than discovering it on the day.
 */

export interface AffectedTrip {
  reference: string;
  /** Manila wall-clock date, `YYYY-MM-DD`. */
  startDate: string;
  requestor: string;
}

/**
 * Derived from the SHARED `SCHEDULED_STATUSES`, never a local `new Set([...])`.
 * A local copy silently stops being correct the moment a status is added, and
 * this project has already added one — the fifth status went in and every local
 * set became a quiet bug.
 */
const SCHEDULED_DB_STATUSES = [...SCHEDULED_STATUSES].map(
  (status) => STATUS_TO_DB[status],
);

export async function affectedTrips(
  db: Kysely<DB>,
  target: "driver" | "van",
  id: string,
  /** Manila plain date, `YYYY-MM-DD`. Passed in so this is testable. */
  today: string,
): Promise<AffectedTrip[]> {
  // Manila midnight as an instant. A trip starting LATER today has not run yet,
  // so the bound is the start of the day, not `now()`.
  const from = instantFromManila(today, "00:00");
  if (from === null) return [];

  const column = target === "driver" ? "assigned_driver_id" : "assigned_van_id";

  const rows = await db
    .selectFrom("reservations")
    .select(["reference_no", "requestor_name", "start_at"])
    .where(column, "=", id)
    .where("status", "in", SCHEDULED_DB_STATUSES)
    .where("start_at", ">=", from)
    // Soonest first: the nearest problem is the one to act on.
    .orderBy("start_at", "asc")
    .execute();

  return rows.map((row) => ({
    reference: row.reference_no,
    startDate: instantInManila(row.start_at)?.date ?? "",
    requestor: row.requestor_name,
  }));
}
