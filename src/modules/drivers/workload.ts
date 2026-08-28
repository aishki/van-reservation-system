import { addPlainDays } from "@/lib/tz";
import { type Driver, WEEKLY_HOURS_CAP } from "@/modules/drivers/types";
import { tripMinutes } from "@/modules/reservations/calendar";
import {
  type ReservationRow,
  SCHEDULED_STATUSES,
} from "@/modules/reservations/types";

/**
 * How much of a week each driver is carrying (FR-14).
 *
 * Derived from the reservations that name them, not stored. The design's own
 * mock hard-codes a trip count, an hours string and a percentage per driver —
 * three numbers that cannot disagree with the schedule because they have no
 * connection to it. Deriving means a trip reassigned in the drawer moves the
 * bar here, which is the only way this screen is worth looking at.
 */

/**
 * Who a workload row is about: a roster driver (has an id, a site, a shift,
 * a cap) or a rental driver (a per-trip name with none of those, grouped by
 * name since a rental has no id to group on).
 */
export type WorkloadSubject =
  | { kind: "roster"; driver: Driver }
  | { kind: "rental"; name: string };

export interface DriverWorkload {
  subject: WorkloadSubject;
  /** Trips assigned in the week. */
  trips: number;
  /** Scheduled minutes, using the same duration model as the calendar. */
  minutes: number;
  /** Minutes as hours, one decimal place. */
  hours: number;
  /**
   * Fraction of `WEEKLY_HOURS_CAP`, 0–1 and NOT clamped above 1. Null for a
   * rental: the cap is a staffing rule for employees, and drawing a bar
   * against it for a contractor would assert something untrue.
   */
  load: number | null;
  /** Scheduled beyond the weekly cap. Always false for a rental. */
  over: boolean;
  /**
   * Distinct van labels driven in the week, in first-seen order. Deduped on
   * the `(vanSource, vanLabel)` pair, never the label alone — nothing stops
   * an admin typing a roster van's number into a rental's, and deduping by
   * label would merge the two onto one entry.
   */
  vans: string[];
}

interface Accum {
  trips: number;
  minutes: number;
  vans: string[];
  seenVanKeys: Set<string>;
}

function emptyAccum(): Accum {
  return { trips: 0, minutes: 0, vans: [], seenVanKeys: new Set() };
}

function chargeRow(accum: Accum, row: ReservationRow): void {
  accum.trips += 1;
  // A malformed time contributes a trip but no minutes: the assignment is
  // real even when its duration is not readable, and dropping the row would
  // under-report how many trips the driver has.
  accum.minutes += tripMinutes(row) ?? 0;
  if (row.vanLabel !== null) {
    const vanKey = `${row.vanSource}:${row.vanLabel}`;
    if (!accum.seenVanKeys.has(vanKey)) {
      accum.seenVanKeys.add(vanKey);
      accum.vans.push(row.vanLabel);
    }
  }
}

function subjectName(subject: WorkloadSubject): string {
  return subject.kind === "roster" ? subject.driver.name : subject.name;
}

/**
 * Workload for every driver over the seven days from `weekStart`.
 *
 * Every roster driver appears, including one with no trips. A driver who
 * drops off the list when idle is invisible exactly when an admin is looking
 * for someone free — which is the question this screen answers. Rental
 * drivers get their own rows, one per distinct name seen that week.
 *
 * Rows naming a roster driver id that is not on the roster are ignored
 * rather than inventing a row for them; `unassignedTrips` reports how much
 * work has no driver at all, which is the number that actually needs
 * acting on.
 */
export function weeklyWorkload(
  drivers: readonly Driver[],
  rows: readonly ReservationRow[],
  weekStart: string,
): { workloads: DriverWorkload[]; unassignedTrips: number } {
  const week = new Set(
    Array.from(
      { length: 7 },
      (_, offset) => addPlainDays(weekStart, offset) ?? weekStart,
    ),
  );

  const inWeek = rows.filter(
    (row) => SCHEDULED_STATUSES.has(row.status) && week.has(row.startDate),
  );

  // Keyed by driverId for roster rows, and by driver name for rental rows —
  // grouping rentals by id would leave every one-off in its own bucket,
  // since a rental has no id at all.
  const rosterTotals = new Map<string, Accum>();
  const rentalTotals = new Map<string, Accum>();
  let unassignedTrips = 0;

  for (const row of inWeek) {
    if (row.driverSource === "rental") {
      // Invariant: a rental row always names its driver. If it somehow
      // doesn't, there is nothing to group it by, so it charges nobody.
      if (row.driver === null) continue;
      const accum = rentalTotals.get(row.driver) ?? emptyAccum();
      rentalTotals.set(row.driver, accum);
      chargeRow(accum, row);
      continue;
    }
    if (row.driverSource !== "roster" || row.driverId === null) {
      unassignedTrips += 1;
      continue;
    }
    const accum = rosterTotals.get(row.driverId) ?? emptyAccum();
    rosterTotals.set(row.driverId, accum);
    chargeRow(accum, row);
  }

  const rosterWorkloads = drivers.map<DriverWorkload>((driver) => {
    const { trips, minutes, vans } =
      rosterTotals.get(driver.id) ?? emptyAccum();
    const hours = Math.round((minutes / 60) * 10) / 10;
    return {
      subject: { kind: "roster", driver },
      trips,
      minutes,
      hours,
      load: hours / WEEKLY_HOURS_CAP,
      over: hours > WEEKLY_HOURS_CAP,
      vans,
    };
  });

  const rentalWorkloads = Array.from(
    rentalTotals.entries(),
  ).map<DriverWorkload>(([name, { trips, minutes, vans }]) => {
    const hours = Math.round((minutes / 60) * 10) / 10;
    return {
      subject: { kind: "rental", name },
      trips,
      minutes,
      hours,
      load: null,
      over: false,
      vans,
    };
  });

  const workloads = [...rosterWorkloads, ...rentalWorkloads];

  // Busiest first — the reason to open this page is to find who is free, and
  // sorting by name would make that a scan rather than a glance.
  workloads.sort((a, b) =>
    b.minutes === a.minutes
      ? subjectName(a.subject).localeCompare(subjectName(b.subject))
      : b.minutes - a.minutes,
  );

  return { workloads, unassignedTrips };
}
