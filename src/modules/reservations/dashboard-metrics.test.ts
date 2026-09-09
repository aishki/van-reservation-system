import { describe, expect, it } from "vitest";
import {
  monthlyStatusTrend,
  SLA_THRESHOLD_HOURS,
  slaSummary,
  tatHours,
  tripsByType,
} from "@/modules/reservations/dashboard-metrics";
import type { ReservationRow } from "@/modules/reservations/types";

// A minimal row builder — the metrics only read a handful of fields, so the
// rest are filled with inert defaults.
function row(overrides: Partial<ReservationRow>): ReservationRow {
  return {
    id: "REQ-1",
    submittedAt: "2026-08-01T00:00:00Z",
    startDate: "2026-08-05",
    startTime: "07:00",
    endTime: null,
    requestor: "Test",
    site: "Iloilo",
    from: "A",
    to: "B",
    mode: "pickup",
    purpose: "Onshore/Client Visit",
    details: "Test fixture trip.",
    status: "Approved",
    updatedBy: null,
    updatedAt: null,
    remarks: null,
    driver: null,
    driverId: null,
    driverSource: null,
    vanLabel: null,
    vanSource: null,
    vanPlate: null,
    ...overrides,
  };
}

describe("tatHours", () => {
  it("returns the hours between submission and first assignment", () => {
    expect(
      tatHours(
        row({
          submittedAt: "2026-08-01T00:00:00Z",
          firstAssignedAt: "2026-08-01T09:30:00Z",
        }),
      ),
    ).toBe(9.5);
  });

  it.each([
    ["no assignment", { firstAssignedAt: null }],
    ["assignment absent", {}],
    ["unparseable timestamp", { firstAssignedAt: "not-a-date" }],
    [
      "assignment before submission",
      {
        submittedAt: "2026-08-01T10:00:00Z",
        firstAssignedAt: "2026-08-01T09:00:00Z",
      },
    ],
  ])("returns null when %s", (_label, overrides) => {
    expect(tatHours(row(overrides))).toBeNull();
  });
});

describe("slaSummary", () => {
  it("counts only assigned rows, and marks TAT ≤ 12h as within SLA", () => {
    const rows = [
      row({ firstAssignedAt: "2026-08-01T04:00:00Z" }), // 4h — within
      row({ firstAssignedAt: "2026-08-01T12:00:00Z" }), // exactly 12h — within
      row({ firstAssignedAt: "2026-08-01T20:00:00Z" }), // 20h — breach
      row({ firstAssignedAt: null }), // never assigned — excluded
    ];
    expect(slaSummary(rows)).toEqual({
      assigned: 3,
      withinSla: 2,
      avgTatHours: 12, // (4 + 12 + 20) / 3
      slaPct: (2 / 3) * 100,
    });
  });

  it("returns null averages when nothing is assigned", () => {
    expect(slaSummary([row({ firstAssignedAt: null })])).toEqual({
      assigned: 0,
      withinSla: 0,
      avgTatHours: null,
      slaPct: null,
    });
  });

  it("treats the threshold as inclusive", () => {
    const atThreshold = row({
      submittedAt: "2026-08-01T00:00:00Z",
      firstAssignedAt: `2026-08-01T${SLA_THRESHOLD_HOURS}:00:00Z`,
    });
    expect(slaSummary([atThreshold]).withinSla).toBe(1);
  });
});

describe("tripsByType", () => {
  it("counts each ride mode and its share of the whole", () => {
    const rows = [
      row({ mode: "pickup" }),
      row({ mode: "pickup" }),
      row({ mode: "pickup" }),
      row({ mode: "standby" }),
    ];
    const [pickup, standby] = tripsByType(rows);
    expect(pickup).toEqual({
      mode: "pickup",
      label: "Pickup / Drop-Off",
      count: 3,
      pct: 75,
    });
    expect(standby).toMatchObject({ mode: "standby", count: 1, pct: 25 });
  });

  it("reports zero shares for an empty set without dividing by zero", () => {
    expect(tripsByType([])).toEqual([
      { mode: "pickup", label: "Pickup / Drop-Off", count: 0, pct: 0 },
      { mode: "standby", label: "Dedicated Standby Van", count: 0, pct: 0 },
    ]);
  });
});

describe("monthlyStatusTrend", () => {
  it("buckets rows by startDate month, oldest first, every status present", () => {
    const trend = monthlyStatusTrend([
      row({ startDate: "2026-08-05", status: "Approved" }),
      row({ startDate: "2026-08-20", status: "Pending" }),
      row({ startDate: "2026-07-11", status: "Rejected" }),
    ]);

    expect(trend.map((point) => point.month)).toEqual(["2026-07", "2026-08"]);
    expect(trend[0]).toMatchObject({ Rejected: 1, Approved: 0, Pending: 0 });
    expect(trend[1]).toMatchObject({ Approved: 1, Pending: 1, Rejected: 0 });
  });

  it("omits rows with an unparseable startDate from the trend", () => {
    expect(monthlyStatusTrend([row({ startDate: "nope" })])).toEqual([]);
  });
});
