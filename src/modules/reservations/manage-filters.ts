import { comparePlainDates } from "@/lib/tz";
import {
  type ReservationRow,
  RIDE_MODE_LABELS,
  RIDE_MODES,
} from "@/modules/reservations/types";

/**
 * Filtering for the manage-bookings list. Pure, so the counts and the
 * upcoming/past boundary can be tested without rendering a table.
 */

/**
 * The ride-mode tabs, with "all" first and default.
 *
 * A requestor's mental model is "my trips", not "my pickup trips" — landing on a
 * single mode hides half their bookings behind a tab they have no reason to
 * press. `RideMode` itself stays two values: it is the wire format for a
 * booking, and no booking is mode "all".
 */
export const MANAGE_MODES = ["all", ...RIDE_MODES] as const;
export type ManageMode = (typeof MANAGE_MODES)[number];

export const MANAGE_MODE_LABELS: Record<ManageMode, string> = {
  all: "All",
  pickup: RIDE_MODE_LABELS.pickup.title,
  standby: RIDE_MODE_LABELS.standby.title,
};

export const TRIP_WINDOWS = ["all", "upcoming", "past"] as const;
export type TripWindow = (typeof TRIP_WINDOWS)[number];

export const TRIP_WINDOW_LABELS: Record<TripWindow, string> = {
  all: "All Trips",
  upcoming: "Upcoming",
  past: "Past Trips",
};

/**
 * A booking is upcoming while its start date is today or later.
 *
 * `today` is passed in rather than read from the clock: it must be Manila's
 * today, computed once on the server (see `todayInManila`). Deriving it here on
 * each call would put a clock read inside a pure function and let the server and
 * the client disagree across midnight.
 *
 * A row whose `startDate` is unparseable counts as upcoming — it stays visible on
 * the default filter rather than vanishing from every view, which is what
 * treating it as past would do.
 */
export function isUpcoming(row: ReservationRow, today: string): boolean {
  const order = comparePlainDates(row.startDate, today);
  return order === null || order >= 0;
}

export interface ManageFilter {
  mode: ManageMode;
  window: TripWindow;
}

export function filterReservations(
  rows: readonly ReservationRow[],
  filter: ManageFilter,
  today: string,
): ReservationRow[] {
  return rows.filter((row) => {
    if (filter.mode !== "all" && row.mode !== filter.mode) return false;
    if (filter.window === "all") return true;
    return filter.window === "upcoming"
      ? isUpcoming(row, today)
      : !isUpcoming(row, today);
  });
}

/**
 * Counts shown beside each filter.
 *
 * Scoped to the selected ride mode, matching the design: the tabs are the
 * primary split, so a count that ignored them would not add up to the rows on
 * screen. On the "all" tab that scoping is the whole list.
 */
export function windowCounts(
  rows: readonly ReservationRow[],
  mode: ManageMode,
  today: string,
): Record<TripWindow, number> {
  const forMode =
    mode === "all" ? [...rows] : rows.filter((row) => row.mode === mode);
  const upcoming = forMode.filter((row) => isUpcoming(row, today)).length;
  return {
    all: forMode.length,
    upcoming,
    past: forMode.length - upcoming,
  };
}
