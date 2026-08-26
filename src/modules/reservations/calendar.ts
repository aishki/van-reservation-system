import { addPlainDays, minutesSinceMidnight } from "@/lib/tz";
import {
  type ReservationRow,
  SCHEDULED_STATUSES,
} from "@/modules/reservations/types";

/**
 * Laying a week of reservations out on a calendar grid. Pure, so the placement
 * arithmetic — which is where a calendar goes wrong — can be tested without
 * rendering anything.
 */

/** One row of the time gutter. The design's grid is 30-minute rows at 36px. */
export const SLOT_MINUTES = 30;
export const SLOT_HEIGHT_PX = 36;
export const MINUTES_PER_DAY = 24 * 60;

/** The window the grid shows unless the week's trips need more of the day. */
export const DEFAULT_WINDOW_START = 6 * 60;
export const DEFAULT_WINDOW_END = 19 * 60;

/**
 * A pickup has a start and no end. Half an hour is the block it occupies on the
 * grid — long enough to be clickable, and honest about being a default rather
 * than a measurement, since nothing in the process records how long a transfer
 * takes.
 */
export const PICKUP_BLOCK_MINUTES = 30;

/**
 * How long a reservation occupies a van, in minutes.
 *
 * One model, used by both the calendar (block height) and the driver workload
 * (hours against the weekly cap), so the two views can never disagree about how
 * long the same trip takes. A standby block that ends at or before it starts
 * runs past midnight and is measured to the end of the day.
 *
 * Returns null when either time is malformed, so a caller has to decide what to
 * do about it rather than silently treating the trip as zero-length.
 */
export function tripMinutes(row: ReservationRow): number | null {
  const start = minutesSinceMidnight(row.startTime);
  if (start === null) return null;
  if (row.endTime === null) return PICKUP_BLOCK_MINUTES;

  const end = minutesSinceMidnight(row.endTime);
  if (end === null) return null;
  return end <= start ? MINUTES_PER_DAY - start : end - start;
}

export interface CalendarEvent {
  row: ReservationRow;
  /** Minutes since midnight, clamped into the day. */
  startMinute: number;
  endMinute: number;
  /** Column within its day when trips overlap; 0 is leftmost. */
  lane: number;
  /** How many lanes that day's overlapping group needs. */
  lanes: number;
  /**
   * Index of the overlap cluster this event belongs to, within its day.
   *
   * The view needs the GROUP, not just each member's lane: a cluster of three
   * or more is drawn as one block, and `lanes` alone cannot say which events
   * share it.
   */
  cluster: number;
  /**
   * True when the booking's end time is at or before its start, which for a
   * standby block means it runs past midnight. Drawn to the end of the day
   * rather than backwards or zero-height.
   */
  crossesMidnight: boolean;
  /**
   * No driver or no van is assigned yet — the design's PENDING badge.
   *
   * Before driver and van split, `driver` WAS the van, so one field covered
   * both gaps. Now a Pending trip can hold a driver with no van (or vice
   * versa) and still needs to read as unstaffed, so this widens to either
   * side rather than tracking the driver alone.
   *
   * Read off the assignment itself, not inferred from `status === "Approved"`.
   * A database constraint currently forces those two to agree, so the inference
   * would work today and would be wrong the moment it stops holding.
   */
  awaitingAssignment: boolean;
  /**
   * Either side of the trip — driver, van, or both — is a rental rather than
   * roster/fleet. An admin scanning the week needs to see that at a glance,
   * the same way `awaitingAssignment` flags a gap.
   */
  isRental: boolean;
}

export interface CalendarDay {
  /** Plain `YYYY-MM-DD`. */
  date: string;
  events: CalendarEvent[];
  /** The same events, grouped by overlap. Every event appears exactly once. */
  clusters: CalendarEvent[][];
}

export interface CalendarWeek {
  days: CalendarDay[];
  /** Minutes since midnight; the vertical extent the grid must draw. */
  windowStart: number;
  windowEnd: number;
  /** Rows in this week that could not be placed — malformed times. */
  unplaced: ReservationRow[];
}

/**
 * Build one week's grid.
 *
 * The window is widened past the design's fixed 6am–6pm whenever a trip falls
 * outside it. A fixed window silently hides a 5am airport run: it is not drawn,
 * nothing says so, and the calendar an admin uses to spot conflicts is missing
 * the trip. Widening keeps the common week identical to the design and makes
 * the uncommon one visible.
 */
export function buildCalendarWeek(
  rows: readonly ReservationRow[],
  weekStart: string,
): CalendarWeek {
  const days = weekDates(weekStart);
  const unplaced: ReservationRow[] = [];

  const perDay = days.map<CalendarDay>((date) => ({
    date,
    events: [],
    clusters: [],
  }));
  const byDate = new Map(perDay.map((day) => [day.date, day]));

  for (const row of rows) {
    if (!SCHEDULED_STATUSES.has(row.status)) continue;
    const day = byDate.get(row.startDate);
    if (day === undefined) continue;

    const startMinute = minutesSinceMidnight(row.startTime);
    if (startMinute === null) {
      unplaced.push(row);
      continue;
    }

    const rawEnd =
      row.endTime === null ? null : minutesSinceMidnight(row.endTime);
    if (row.endTime !== null && rawEnd === null) {
      unplaced.push(row);
      continue;
    }

    const crossesMidnight = rawEnd !== null && rawEnd <= startMinute;
    const endMinute = crossesMidnight
      ? MINUTES_PER_DAY
      : Math.min(rawEnd ?? startMinute + PICKUP_BLOCK_MINUTES, MINUTES_PER_DAY);

    day.events.push({
      row,
      startMinute,
      endMinute,
      lane: 0,
      lanes: 1,
      cluster: 0,
      crossesMidnight,
      awaitingAssignment: row.driver === null || row.vanLabel === null,
      isRental: row.driverSource === "rental" || row.vanSource === "rental",
    });
  }

  let windowStart = DEFAULT_WINDOW_START;
  let windowEnd = DEFAULT_WINDOW_END;
  for (const day of perDay) {
    day.clusters = assignLanes(day.events);
    for (const event of day.events) {
      windowStart = Math.min(windowStart, floorToHour(event.startMinute));
      windowEnd = Math.max(windowEnd, ceilToHour(event.endMinute));
    }
  }

  return { days: perDay, windowStart, windowEnd, unplaced };
}

/** The seven plain dates of the week beginning on `weekStart`. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = addPlainDays(weekStart, offset);
    // `weekStart` always comes from `startOfWeek`, which has already validated
    // it. Falling back to the input keeps the signature total rather than
    // spreading nulls through the grid.
    return date ?? weekStart;
  });
}

/**
 * Give every overlapping event its own column.
 *
 * Without this, two trips at the same hour on the same day are drawn on top of
 * each other and the second is invisible — on a calendar whose entire purpose
 * is spotting exactly that collision. Greedy interval colouring: events are
 * sorted by start, and each takes the first lane whose previous occupant has
 * already ended.
 *
 * Mutates in place; the events were built moments earlier in this module and
 * copying them to add two integers earns nothing.
 */
function assignLanes(events: CalendarEvent[]): CalendarEvent[][] {
  events.sort((a, b) =>
    a.startMinute === b.startMinute
      ? a.endMinute - b.endMinute
      : a.startMinute - b.startMinute,
  );

  // The end minute currently occupying each lane.
  const laneEnds: number[] = [];
  // Events sharing at least one minute with something already placed, so the
  // whole cluster can be given the same lane count once it closes.
  let cluster: CalendarEvent[] = [];
  let clusterEnd = -1;

  // The groups themselves, which the view needs to collapse a stack of three.
  // They were already being computed and thrown away.
  const clusters: CalendarEvent[][] = [];

  const closeCluster = () => {
    const width = Math.max(1, laneEnds.length);
    const index = clusters.length;
    for (const event of cluster) {
      event.lanes = width;
      event.cluster = index;
    }
    clusters.push(cluster);
    cluster = [];
    laneEnds.length = 0;
  };

  for (const event of events) {
    if (event.startMinute >= clusterEnd && cluster.length > 0) closeCluster();

    let lane = laneEnds.findIndex((end) => end <= event.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(event.endMinute);
    } else {
      laneEnds[lane] = event.endMinute;
    }

    event.lane = lane;
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, event.endMinute);
  }

  if (cluster.length > 0) closeCluster();
  return clusters;
}

function floorToHour(minute: number): number {
  return Math.floor(minute / 60) * 60;
}

function ceilToHour(minute: number): number {
  return Math.min(MINUTES_PER_DAY, Math.ceil(minute / 60) * 60);
}

/** Hour marks for the time gutter, inclusive of both ends of the window. */
export function gutterHours(windowStart: number, windowEnd: number): number[] {
  const hours: number[] = [];
  for (let minute = windowStart; minute < windowEnd; minute += 60) {
    hours.push(minute);
  }
  return hours;
}
