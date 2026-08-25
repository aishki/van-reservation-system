import { formatPlainMonth, monthOf } from "@/lib/tz";
import {
  RESERVATION_STATUSES,
  type ReservationRow,
  type ReservationStatus,
  RIDE_MODE_LABELS,
  RIDE_MODES,
  type RideMode,
} from "@/modules/reservations/types";

/**
 * Analytics for the admin dashboard. Pure, so the TAT/SLA maths and the chart
 * series are tested without rendering a chart.
 *
 * TAT and SLA are defined by the product, not the SRS: turnaround time is the
 * gap from a request's submission to the FIRST driver assignment/confirmation
 * (the first counts even if the driver is later reassigned), and a trip is
 * within SLA when that turnaround is at most `SLA_THRESHOLD_HOURS`.
 */

/** A trip is within SLA when its turnaround time is at most this many hours. */
export const SLA_THRESHOLD_HOURS = 12;

/**
 * Turnaround time in hours for one request: first-assignment instant minus
 * submission instant. Null when the request was never assigned (no
 * `firstAssignedAt`), a timestamp is unparseable, or the assignment somehow
 * precedes submission — all outside the TAT/SLA population.
 */
export function tatHours(row: ReservationRow): number | null {
  if (!row.firstAssignedAt) return null;
  const assigned = Date.parse(row.firstAssignedAt);
  const submitted = Date.parse(row.submittedAt);
  if (Number.isNaN(assigned) || Number.isNaN(submitted)) return null;
  const hours = (assigned - submitted) / 3_600_000;
  return hours >= 0 ? hours : null;
}

export interface SlaSummary {
  /** Requests with a first assignment — the population TAT/SLA are measured over. */
  assigned: number;
  /** Of those, how many turned around within `SLA_THRESHOLD_HOURS`. */
  withinSla: number;
  /** Mean turnaround in hours, or null when nothing is assigned. */
  avgTatHours: number | null;
  /** Share within SLA as a percentage (0–100), or null when nothing is assigned. */
  slaPct: number | null;
}

export function slaSummary(rows: readonly ReservationRow[]): SlaSummary {
  let assigned = 0;
  let withinSla = 0;
  let totalHours = 0;

  for (const row of rows) {
    const tat = tatHours(row);
    if (tat === null) continue;
    assigned += 1;
    totalHours += tat;
    if (tat <= SLA_THRESHOLD_HOURS) withinSla += 1;
  }

  return {
    assigned,
    withinSla,
    avgTatHours: assigned === 0 ? null : totalHours / assigned,
    slaPct: assigned === 0 ? null : (withinSla / assigned) * 100,
  };
}

export interface TypeSlice {
  mode: RideMode;
  label: string;
  count: number;
  /** Share of all rows as a percentage (0–100). */
  pct: number;
}

/** Counts by ride mode, one slice per mode (zero when none), for the type bars. */
export function tripsByType(rows: readonly ReservationRow[]): TypeSlice[] {
  const total = rows.length;
  return RIDE_MODES.map((mode) => {
    const count = rows.filter((row) => row.mode === mode).length;
    return {
      mode,
      label: RIDE_MODE_LABELS[mode].title,
      count,
      pct: total === 0 ? 0 : (count / total) * 100,
    };
  });
}

export type TrendPoint = { month: string; label: string } & Record<
  ReservationStatus,
  number
>;

const zeroCounts = (): Record<ReservationStatus, number> =>
  Object.fromEntries(
    RESERVATION_STATUSES.map((status) => [status, 0]),
  ) as Record<ReservationStatus, number>;

/**
 * Monthly counts per status, oldest month first, keyed by `startDate`'s month.
 * A row whose `startDate` has no parseable month is left out of the trend (it
 * still counts everywhere else). Every status key is always present, so the
 * chart draws a stable set of lines rather than reflowing as data arrives.
 */
export function monthlyStatusTrend(
  rows: readonly ReservationRow[],
): TrendPoint[] {
  const byMonth = new Map<string, TrendPoint>();

  for (const row of rows) {
    const month = monthOf(row.startDate);
    if (month === null) continue;
    let point = byMonth.get(month);
    if (point === undefined) {
      point = {
        month,
        label: formatPlainMonth(month) ?? month,
        ...zeroCounts(),
      };
      byMonth.set(month, point);
    }
    point[row.status] += 1;
  }

  return [...byMonth.values()].sort((a, b) =>
    a.month < b.month ? -1 : a.month > b.month ? 1 : 0,
  );
}
