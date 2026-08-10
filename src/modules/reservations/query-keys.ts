/**
 * React Query keys for the reservation surfaces.
 *
 * Shared constants rather than inline literals because a writer and a reader
 * that disagree by one character produce no error anywhere: the invalidation
 * lands on a key nothing is subscribed to, the table keeps painting its old
 * copy, and the only symptom is stale data minutes later. That is precisely the
 * bug this file exists to have fixed once.
 */

/** The admin master list — every reservation, `GET /api/reservations` as an admin. */
export const ADMIN_RESERVATIONS_KEY = ["reservations", "admin"] as const;

/** One reservation's detail, as the trip drawer reads it. */
export function reservationDetailKey(reference: string | null | undefined) {
  return ["reservation-detail", reference] as const;
}
