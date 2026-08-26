import { describe, expect, it } from "vitest";
import {
  buildCalendarWeek,
  DEFAULT_WINDOW_END,
  DEFAULT_WINDOW_START,
  gutterHours,
  MINUTES_PER_DAY,
  PICKUP_BLOCK_MINUTES,
  weekDates,
} from "@/modules/reservations/calendar";
import type { ReservationRow } from "@/modules/reservations/types";

const WEEK = "2026-08-03";

function row(overrides: Partial<ReservationRow> & { id: string }) {
  return {
    submittedAt: "2026-08-01T00:00:00Z",
    startDate: "2026-08-03",
    startTime: "08:00",
    endTime: null,
    requestor: "Dela Cruz, Juan",
    site: "Manila",
    from: "GLS",
    to: "AGT",
    mode: "pickup",
    purpose: "Onshore/Client Visit",
    details: "Test fixture trip.",
    status: "Approved",
    updatedBy: "Abanto, Norlyn",
    updatedAt: null,
    remarks: null,
    driver: null,
    driverId: null,
    driverSource: null,
    vanLabel: null,
    vanSource: null,
    vanPlate: null,
    ...overrides,
  } satisfies ReservationRow;
}

/** All events across the week, flattened, for assertions that ignore the day. */
function allEvents(rows: ReservationRow[], weekStart = WEEK) {
  return buildCalendarWeek(rows, weekStart).days.flatMap((day) => day.events);
}

describe("weekDates", () => {
  it("returns seven consecutive dates from the given Monday", () => {
    expect(weekDates(WEEK)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
  });

  it("crosses a month boundary", () => {
    expect(weekDates("2026-08-31").slice(0, 3)).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });
});

describe("buildCalendarWeek placement", () => {
  it("places a trip on the day it starts", () => {
    const week = buildCalendarWeek(
      [row({ id: "A", startDate: "2026-08-06" })],
      WEEK,
    );
    expect(week.days[3].date).toBe("2026-08-06");
    expect(week.days[3].events.map((e) => e.row.id)).toEqual(["A"]);
    expect(week.days[0].events).toEqual([]);
  });

  it("ignores a trip outside the week", () => {
    expect(allEvents([row({ id: "A", startDate: "2026-08-15" })])).toEqual([]);
  });

  it("gives a pickup a default block because it has no end time", () => {
    const [event] = allEvents([
      row({ id: "A", startTime: "06:30", endTime: null }),
    ]);
    expect(event.startMinute).toBe(390);
    expect(event.endMinute).toBe(390 + PICKUP_BLOCK_MINUTES);
  });

  it("uses a standby booking's real end time", () => {
    const [event] = allEvents([
      row({ id: "A", startTime: "10:00", endTime: "13:00", mode: "standby" }),
    ]);
    expect(event.startMinute).toBe(600);
    expect(event.endMinute).toBe(780);
  });

  // A block ending at or before its start runs past midnight. Drawing it
  // literally gives a negative height, which most browsers render as nothing —
  // the trip silently disappears from the schedule.
  it("draws a past-midnight block to the end of the day", () => {
    const [event] = allEvents([
      row({ id: "A", startTime: "22:00", endTime: "02:00", mode: "standby" }),
    ]);
    expect(event.crossesMidnight).toBe(true);
    expect(event.endMinute).toBe(MINUTES_PER_DAY);
    expect(event.endMinute).toBeGreaterThan(event.startMinute);
  });

  it("treats an end equal to the start as past midnight, not zero-length", () => {
    const [event] = allEvents([
      row({ id: "A", startTime: "09:00", endTime: "09:00", mode: "standby" }),
    ]);
    expect(event.crossesMidnight).toBe(true);
    expect(event.endMinute).toBe(MINUTES_PER_DAY);
  });
});

describe("buildCalendarWeek status filtering", () => {
  it.each(["Pending", "Approved"] as const)("schedules a %s trip", (status) => {
    expect(allEvents([row({ id: "A", status })])).toHaveLength(1);
  });

  // A cancelled trip drawn on the schedule blocks a van against a trip nobody
  // is taking — the exact conflict this view exists to surface.
  it.each(["Cancelled", "Rejected"] as const)(
    "does not schedule a %s trip",
    (status) => {
      expect(allEvents([row({ id: "A", status })])).toEqual([]);
    },
  );

  it("badges a trip with no driver and no van assigned", () => {
    const [unassigned] = allEvents([row({ id: "A" })]);
    const [assigned] = allEvents([
      row({
        id: "B",
        driver: "Villanueva, Rey",
        vanLabel: "VAN-001",
      }),
    ]);
    expect(unassigned.awaitingAssignment).toBe(true);
    expect(assigned.awaitingAssignment).toBe(false);
  });

  // Driver and van split in this branch: a Pending trip can hold one without
  // the other, and either gap alone must still read as unstaffed — a driver
  // with no van covered the same badge before the split, when `driver` WAS
  // the van.
  it("badges a trip with a driver but no van", () => {
    const [event] = allEvents([
      row({ id: "A", driver: "Villanueva, Rey", vanLabel: null }),
    ]);
    expect(event.awaitingAssignment).toBe(true);
  });

  it("badges a trip with a van but no driver", () => {
    const [event] = allEvents([
      row({ id: "A", driver: null, vanLabel: "VAN-001" }),
    ]);
    expect(event.awaitingAssignment).toBe(true);
  });

  // The badge reads the assignment, not the status. A database constraint keeps
  // "approved" and "has a driver and van" in step today, so inferring one from
  // the other works — right up until it does not, and then the calendar
  // quietly tells an admin a trip is covered when it is not.
  it("badges an approved trip that somehow has no driver or van", () => {
    const [event] = allEvents([
      row({ id: "A", status: "Approved", driver: null, vanLabel: null }),
    ]);
    expect(event.awaitingAssignment).toBe(true);
  });

  it("flags an event whose driver or van is a rental", () => {
    const events = allEvents([
      row({ id: "A", driverSource: "rental", vanSource: "roster" }),
      row({ id: "B", driverSource: "roster", vanSource: "rental" }),
      row({ id: "C", driverSource: "roster", vanSource: "roster" }),
    ]);
    expect(events.map((e) => e.isRental)).toEqual([true, true, false]);
  });

  // Regression: `driver` resolves a rental name (Task 5), so a rental-staffed
  // trip must NOT read as awaiting an assignment.
  it("does not mark a rental-driver trip as awaiting an assignment", () => {
    const [event] = allEvents([
      row({
        id: "A",
        driver: "Rental Ramos",
        driverSource: "rental",
        vanLabel: "VAN-001",
      }),
    ]);
    expect(event.awaitingAssignment).toBe(false);
  });
});

describe("buildCalendarWeek window", () => {
  it("uses the default window when every trip fits inside it", () => {
    const week = buildCalendarWeek(
      [row({ id: "A", startTime: "09:00" })],
      WEEK,
    );
    expect(week.windowStart).toBe(DEFAULT_WINDOW_START);
    expect(week.windowEnd).toBe(DEFAULT_WINDOW_END);
  });

  // A fixed 6am window hides a 5am airport run entirely: not drawn, nothing
  // said, and the schedule an admin checks for conflicts is missing a trip.
  it("widens the window for an early trip", () => {
    const week = buildCalendarWeek(
      [row({ id: "A", startTime: "04:45" })],
      WEEK,
    );
    expect(week.windowStart).toBe(4 * 60);
    expect(week.windowEnd).toBe(DEFAULT_WINDOW_END);
  });

  it("widens the window for a late trip", () => {
    const week = buildCalendarWeek(
      [row({ id: "A", startTime: "20:30", endTime: "22:15", mode: "standby" })],
      WEEK,
    );
    expect(week.windowEnd).toBe(23 * 60);
    expect(week.windowStart).toBe(DEFAULT_WINDOW_START);
  });

  it("never widens past the end of the day", () => {
    const week = buildCalendarWeek(
      [row({ id: "A", startTime: "23:30", endTime: "01:00", mode: "standby" })],
      WEEK,
    );
    expect(week.windowEnd).toBe(MINUTES_PER_DAY);
  });

  it("keeps the default window for an empty week", () => {
    const week = buildCalendarWeek([], WEEK);
    expect(week.windowStart).toBe(DEFAULT_WINDOW_START);
    expect(week.windowEnd).toBe(DEFAULT_WINDOW_END);
    expect(week.days).toHaveLength(7);
  });
});

describe("buildCalendarWeek lanes", () => {
  it("gives a lone trip the full width", () => {
    const [event] = allEvents([row({ id: "A" })]);
    expect(event).toMatchObject({ lane: 0, lanes: 1 });
  });

  // Without lanes these two are drawn on top of each other and the second is
  // invisible — on the one view whose purpose is spotting the collision.
  it("splits two overlapping trips into two lanes", () => {
    const events = allEvents([
      row({ id: "A", startTime: "09:00", endTime: "11:00", mode: "standby" }),
      row({ id: "B", startTime: "10:00", endTime: "12:00", mode: "standby" }),
    ]);
    expect(events.map((e) => [e.row.id, e.lane, e.lanes])).toEqual([
      ["A", 0, 2],
      ["B", 1, 2],
    ]);
  });

  it("reuses a lane once the previous trip has ended", () => {
    const events = allEvents([
      row({ id: "A", startTime: "09:00", endTime: "10:00", mode: "standby" }),
      row({ id: "B", startTime: "10:00", endTime: "11:00", mode: "standby" }),
    ]);
    // Back-to-back, not overlapping: both take the full width.
    expect(events.map((e) => [e.row.id, e.lane, e.lanes])).toEqual([
      ["A", 0, 1],
      ["B", 0, 1],
    ]);
  });

  it("gives every member of a cluster the same width", () => {
    const events = allEvents([
      row({ id: "A", startTime: "09:00", endTime: "12:00", mode: "standby" }),
      row({ id: "B", startTime: "09:30", endTime: "10:30", mode: "standby" }),
      row({ id: "C", startTime: "11:00", endTime: "11:30", mode: "standby" }),
    ]);
    // C overlaps A but not B, so it can take B's vacated lane — and all three
    // must be drawn at the same width or they will not line up.
    expect(events.map((e) => e.lanes)).toEqual([2, 2, 2]);
    expect(events.map((e) => [e.row.id, e.lane])).toEqual([
      ["A", 0],
      ["B", 1],
      ["C", 1],
    ]);
  });

  // Inside a cluster a lane frees the instant its occupant ends, so a trip
  // starting exactly then reuses it. Requiring a strict gap instead opens a
  // third column that stays empty and narrows all three blocks for nothing —
  // and the cluster boundary hides that mistake in the simpler back-to-back
  // case above, so this is the arrangement that catches it.
  it("reuses a lane for a trip starting the minute the last one ends", () => {
    const events = allEvents([
      row({ id: "A", startTime: "09:00", endTime: "11:00", mode: "standby" }),
      row({ id: "B", startTime: "10:00", endTime: "10:30", mode: "standby" }),
      row({ id: "C", startTime: "10:30", endTime: "11:30", mode: "standby" }),
    ]);
    expect(events.map((e) => [e.row.id, e.lane])).toEqual([
      ["A", 0],
      ["B", 1],
      ["C", 1],
    ]);
    expect(events.map((e) => e.lanes)).toEqual([2, 2, 2]);
  });

  it("keeps lanes independent between days", () => {
    const week = buildCalendarWeek(
      [
        row({ id: "A", startDate: "2026-08-03", startTime: "09:00" }),
        row({ id: "B", startDate: "2026-08-04", startTime: "09:00" }),
      ],
      WEEK,
    );
    expect(week.days[0].events[0]).toMatchObject({ lane: 0, lanes: 1 });
    expect(week.days[1].events[0]).toMatchObject({ lane: 0, lanes: 1 });
  });

  it("orders a day's events by start time", () => {
    const week = buildCalendarWeek(
      [
        row({ id: "late", startTime: "16:00" }),
        row({ id: "early", startTime: "07:00" }),
        row({ id: "mid", startTime: "11:00" }),
      ],
      WEEK,
    );
    expect(week.days[0].events.map((e) => e.row.id)).toEqual([
      "early",
      "mid",
      "late",
    ]);
  });
});

describe("buildCalendarWeek unplaced rows", () => {
  it("reports a trip whose start time is malformed rather than dropping it", () => {
    const week = buildCalendarWeek(
      [row({ id: "A", startTime: "25:00" })],
      WEEK,
    );
    expect(week.unplaced.map((r) => r.id)).toEqual(["A"]);
    expect(week.days.flatMap((d) => d.events)).toEqual([]);
  });

  it("reports a trip whose end time is malformed", () => {
    const week = buildCalendarWeek(
      [row({ id: "A", startTime: "09:00", endTime: "nope", mode: "standby" })],
      WEEK,
    );
    expect(week.unplaced.map((r) => r.id)).toEqual(["A"]);
  });

  it("reports nothing when every trip places", () => {
    expect(buildCalendarWeek([row({ id: "A" })], WEEK).unplaced).toEqual([]);
  });
});

describe("gutterHours", () => {
  it("marks each hour from the start up to but not past the end", () => {
    expect(gutterHours(6 * 60, 9 * 60)).toEqual([360, 420, 480]);
  });

  it("is empty for a zero-width window", () => {
    expect(gutterHours(6 * 60, 6 * 60)).toEqual([]);
  });
});

/** A standby block, so `endTime` actually bounds the event. */
const span = (id: string, start: string, end: string, date = WEEK) =>
  row({ id, startTime: start, endTime: end, startDate: date });

describe("calendar clusters", () => {
  const clustersOf = (rows: ReservationRow[], date = WEEK) => {
    const week = buildCalendarWeek(rows, WEEK);
    const day = week.days.find((candidate) => candidate.date === date);
    if (day === undefined) throw new Error(`no day ${date}`);
    return day.clusters;
  };

  it("gives a lone trip its own cluster", () => {
    const clusters = clustersOf([span("A", "08:00", "09:00")]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].map((event) => event.row.id)).toEqual(["A"]);
  });

  it("groups two overlapping trips into one cluster", () => {
    const clusters = clustersOf([
      span("A", "08:00", "10:00"),
      span("B", "09:00", "11:00"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].map((event) => event.row.id).sort()).toEqual(["A", "B"]);
  });

  it("groups three overlapping trips into one cluster", () => {
    const clusters = clustersOf([
      span("A", "08:00", "12:00"),
      span("B", "09:00", "11:00"),
      span("C", "10:00", "13:00"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it("separates trips that do not overlap", () => {
    const clusters = clustersOf([
      span("A", "08:00", "09:00"),
      span("B", "10:00", "11:00"),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((group) => group[0].row.id)).toEqual(["A", "B"]);
  });

  // Chained overlap: A overlaps B, B overlaps C, A and C do not touch. All
  // three contest the same column, so all three are one cluster.
  it("groups a chain of overlaps transitively", () => {
    const clusters = clustersOf([
      span("A", "08:00", "10:00"),
      span("B", "09:30", "11:30"),
      span("C", "11:00", "13:00"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it("indexes clusters per day, not across the week", () => {
    const week = buildCalendarWeek(
      [
        span("A", "08:00", "09:00", "2026-08-03"),
        span("B", "08:00", "09:00", "2026-08-04"),
      ],
      WEEK,
    );
    const monday = week.days[0];
    const tuesday = week.days[1];
    expect(monday.events[0].cluster).toBe(0);
    expect(tuesday.events[0].cluster).toBe(0);
  });

  it("keeps every event reachable from exactly one cluster", () => {
    const week = buildCalendarWeek(
      [
        span("A", "08:00", "10:00"),
        span("B", "09:00", "11:00"),
        span("C", "14:00", "15:00"),
        span("D", "08:00", "09:00", "2026-08-05"),
      ],
      WEEK,
    );
    for (const day of week.days) {
      const flattened = day.clusters.flat().map((event) => event.row.id);
      expect(flattened.sort()).toEqual(
        day.events.map((event) => event.row.id).sort(),
      );
      expect(new Set(flattened).size).toBe(flattened.length);
    }
  });

  it("stamps each event with the index of the cluster holding it", () => {
    const week = buildCalendarWeek(
      [span("A", "08:00", "09:00"), span("B", "10:00", "11:00")],
      WEEK,
    );
    const monday = week.days[0];
    for (const [index, group] of monday.clusters.entries()) {
      for (const event of group) expect(event.cluster).toBe(index);
    }
  });

  // The guard that Task 1's shared status set is actually doing its job: under
  // a local `new Set(["Pending", "Approved"])` this trip vanishes from the
  // schedule while a van and a driver are committed to it.
  it("places a reassigned trip on the schedule", () => {
    const week = buildCalendarWeek(
      [
        row({
          id: "R",
          status: "Approved - Driver Reassigned",
          startDate: WEEK,
        }),
      ],
      WEEK,
    );
    expect(week.days[0].events).toHaveLength(1);
  });
});
