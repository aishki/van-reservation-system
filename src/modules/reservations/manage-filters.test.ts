import { describe, expect, it } from "vitest";
import {
  filterReservations,
  isUpcoming,
  MANAGE_MODE_LABELS,
  MANAGE_MODES,
  TRIP_WINDOW_LABELS,
  TRIP_WINDOWS,
  windowCounts,
} from "@/modules/reservations/manage-filters";
import type {
  ReservationRow,
  ReservationStatus,
  RideMode,
} from "@/modules/reservations/types";

const TODAY = "2026-08-05";

function row(
  overrides: Partial<ReservationRow> & { id: string },
): ReservationRow {
  return {
    submittedAt: "2026-08-01T02:00:00Z",
    startDate: "2026-08-10",
    startTime: "08:00",
    endTime: null,
    remarks: null,
    driver: null,
    driverId: null,
    driverSource: null,
    vanLabel: null,
    vanSource: null,
    vanPlate: null,
    requestor: "Jimera, Arielle",
    site: "Manila",
    from: "GLS",
    to: "AGT",
    mode: "pickup",
    purpose: "Onshore/Client Visit",
    details: "Test fixture trip.",
    status: "Pending" as ReservationStatus,
    updatedBy: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("isUpcoming", () => {
  it.each([
    ["tomorrow", "2026-08-06", true],
    ["next month", "2026-09-01", true],
    ["yesterday", "2026-08-04", false],
    ["last month", "2026-07-01", false],
  ])("treats %s as upcoming=%s", (_label, startDate, expected) => {
    expect(isUpcoming(row({ id: "R", startDate }), TODAY)).toBe(expected);
  });

  // The boundary is the whole point: a trip happening TODAY has not happened
  // yet, so it must stay in Upcoming. An off-by-one here silently moves every
  // same-day booking into Past, which is where nobody looks.
  it("counts a trip starting today as upcoming, not past", () => {
    expect(isUpcoming(row({ id: "R", startDate: TODAY }), TODAY)).toBe(true);
  });

  // Vanishing from every filter is the worst outcome for a malformed row: the
  // requestor cannot see it, so cannot cancel it.
  it.each(["", "not-a-date", "2026-02-30"])(
    "keeps a row with the unparseable start date %s visible as upcoming",
    (startDate) => {
      expect(isUpcoming(row({ id: "R", startDate }), TODAY)).toBe(true);
    },
  );
});

describe("filterReservations", () => {
  const rows = [
    row({ id: "P-up", mode: "pickup", startDate: "2026-08-10" }),
    row({ id: "P-past", mode: "pickup", startDate: "2026-07-30" }),
    row({ id: "S-up", mode: "standby", startDate: "2026-08-12" }),
    row({ id: "S-past", mode: "standby", startDate: "2026-07-20" }),
  ];

  const ids = (mode: RideMode, window: (typeof TRIP_WINDOWS)[number]) =>
    filterReservations(rows, { mode, window }, TODAY).map((r) => r.id);

  it("scopes every window to the selected ride mode", () => {
    expect(ids("pickup", "all")).toEqual(["P-up", "P-past"]);
    expect(ids("standby", "all")).toEqual(["S-up", "S-past"]);
  });

  it("splits upcoming from past within a mode", () => {
    expect(ids("pickup", "upcoming")).toEqual(["P-up"]);
    expect(ids("pickup", "past")).toEqual(["P-past"]);
    expect(ids("standby", "upcoming")).toEqual(["S-up"]);
    expect(ids("standby", "past")).toEqual(["S-past"]);
  });

  it("preserves the incoming order rather than resorting", () => {
    // The list arrives newest-first from the server; re-sorting here would
    // silently override that.
    expect(ids("pickup", "all")).toEqual(["P-up", "P-past"]);
  });

  it("never mutates its input", () => {
    const snapshot = JSON.stringify(rows);
    filterReservations(rows, { mode: "pickup", window: "past" }, TODAY);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it("returns an empty array rather than everything when nothing matches", () => {
    const onlyPickup = [row({ id: "P", mode: "pickup" })];
    expect(
      filterReservations(onlyPickup, { mode: "standby", window: "all" }, TODAY),
    ).toEqual([]);
  });
});

describe("windowCounts", () => {
  const rows = [
    row({ id: "a", mode: "pickup", startDate: "2026-08-10" }),
    row({ id: "b", mode: "pickup", startDate: "2026-08-05" }),
    row({ id: "c", mode: "pickup", startDate: "2026-07-01" }),
    row({ id: "d", mode: "standby", startDate: "2026-08-20" }),
  ];

  it("counts within the selected mode only", () => {
    expect(windowCounts(rows, "pickup", TODAY)).toEqual({
      all: 3,
      upcoming: 2,
      past: 1,
    });
    expect(windowCounts(rows, "standby", TODAY)).toEqual({
      all: 1,
      upcoming: 1,
      past: 0,
    });
  });

  // The counts sit beside filters that produce the rows; if they disagree, the
  // sidebar is lying about what a click will show.
  it.each(["pickup", "standby"] as const)(
    "agrees with filterReservations for every window on %s",
    (mode) => {
      const counts = windowCounts(rows, mode, TODAY);
      for (const window of TRIP_WINDOWS) {
        expect(filterReservations(rows, { mode, window }, TODAY)).toHaveLength(
          counts[window],
        );
      }
    },
  );

  it("keeps upcoming and past summing to all", () => {
    const counts = windowCounts(rows, "pickup", TODAY);
    expect(counts.upcoming + counts.past).toBe(counts.all);
  });

  it("returns zeroes for an empty list rather than throwing", () => {
    expect(windowCounts([], "pickup", TODAY)).toEqual({
      all: 0,
      upcoming: 0,
      past: 0,
    });
  });
});

describe("TRIP_WINDOW_LABELS", () => {
  it("labels every window", () => {
    for (const window of TRIP_WINDOWS) {
      expect(TRIP_WINDOW_LABELS[window].trim()).not.toBe("");
    }
  });
});

describe("the All ride-mode tab", () => {
  const rows = [
    row({ id: "P-up", mode: "pickup", startDate: "2026-08-10" }),
    row({ id: "P-past", mode: "pickup", startDate: "2026-07-30" }),
    row({ id: "S-up", mode: "standby", startDate: "2026-08-12" }),
    row({ id: "S-past", mode: "standby", startDate: "2026-07-20" }),
  ];

  it("combines both ride modes", () => {
    const ids = filterReservations(rows, { mode: "all", window: "all" }, TODAY)
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual(["P-past", "P-up", "S-past", "S-up"]);
  });

  it("still honours the upcoming/past window", () => {
    const ids = filterReservations(
      rows,
      { mode: "all", window: "upcoming" },
      TODAY,
    )
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual(["P-up", "S-up"]);
  });

  it("counts across both modes", () => {
    expect(windowCounts(rows, "all", TODAY)).toEqual({
      all: 4,
      upcoming: 2,
      past: 2,
    });
  });

  it("is the first tab, so it is the default", () => {
    expect(MANAGE_MODES[0]).toBe("all");
    expect(MANAGE_MODE_LABELS.all).toBe("All");
  });
});
