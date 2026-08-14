import { describe, expect, it } from "vitest";
import {
  ADMIN_TAB_LABELS,
  ADMIN_TABS,
  type AdminFilter,
  ALL,
  blankAdminFilter,
  filterAdminRequests,
  filterByQuarter,
  matchesQuery,
  monthsOfQuarter,
  pendingCount,
  quartersIn,
  share,
  sortAdminRequests,
  statusBreakdown,
} from "@/modules/reservations/admin-filters";
import {
  RESERVATION_STATUSES,
  type ReservationRow,
} from "@/modules/reservations/types";
import { sampleAdminRequests } from "@/test-fixtures/reservations";

function row(overrides: Partial<ReservationRow> = {}): ReservationRow {
  return {
    id: "REQ-0001",
    submittedAt: "2026-08-01T00:00:00Z",
    startDate: "2026-08-10",
    startTime: "08:00",
    endTime: null,
    requestor: "Dela Cruz, Juan",
    site: "Manila",
    from: "GLS",
    to: "AGT",
    mode: "pickup",
    purpose: "Onshore/Client Visit",
    details: "Test fixture trip.",
    status: "Pending",
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

const ROWS: ReservationRow[] = [
  row({ id: "REQ-1", status: "Pending", site: "Manila", mode: "pickup" }),
  row({ id: "REQ-2", status: "Approved", site: "Manila", mode: "standby" }),
  row({ id: "REQ-3", status: "Pending", site: "Iloilo", mode: "standby" }),
  row({ id: "REQ-4", status: "Rejected", site: "Iloilo", mode: "pickup" }),
  row({ id: "REQ-5", status: "Cancelled", site: "Manila", mode: "pickup" }),
];

const base: AdminFilter = blankAdminFilter();

/**
 * The status filter widened back open, for the tests whose subject is a
 * DIFFERENT filter. `blankAdminFilter` deliberately hides Pending on the
 * Master List, which would otherwise silently narrow every case below.
 */
const everyStatus = { statuses: [...RESERVATION_STATUSES] };

describe("filterAdminRequests", () => {
  it("shows only pending requests on the pending tab", () => {
    const visible = filterAdminRequests(ROWS, { ...base, tab: "pending" });
    expect(visible.map((r) => r.id)).toEqual(["REQ-1", "REQ-3"]);
  });

  it("shows every status on the master list tab", () => {
    const visible = filterAdminRequests(ROWS, {
      ...base,
      ...everyStatus,
      tab: "all",
    });
    expect(visible).toHaveLength(ROWS.length);
  });

  it("narrows to one site", () => {
    const visible = filterAdminRequests(ROWS, {
      ...base,
      ...everyStatus,
      tab: "all",
      site: "Iloilo",
    });
    expect(visible.map((r) => r.id)).toEqual(["REQ-3", "REQ-4"]);
  });

  it("narrows to one ride mode", () => {
    const visible = filterAdminRequests(ROWS, {
      ...base,
      ...everyStatus,
      tab: "all",
      mode: "standby",
    });
    expect(visible.map((r) => r.id)).toEqual(["REQ-2", "REQ-3"]);
  });

  // Each filter narrows the last rather than replacing it. If they were ORed —
  // or if one silently won — the count on screen would not match any single
  // control's setting and neither would be trustworthy.
  it("intersects the tab, site and mode filters", () => {
    const visible = filterAdminRequests(ROWS, {
      ...base,
      tab: "pending",
      site: "Iloilo",
      mode: "standby",
      query: "",
      ...everyStatus,
    });
    expect(visible.map((r) => r.id)).toEqual(["REQ-3"]);
  });

  it("returns nothing when the filters exclude each other", () => {
    const visible = filterAdminRequests(ROWS, {
      ...base,
      tab: "pending",
      site: "Manila",
      mode: "standby",
      query: "",
      ...everyStatus,
    });
    expect(visible).toEqual([]);
  });

  it("does not mutate the array it is given", () => {
    const input = [...ROWS];
    filterAdminRequests(input, { ...base, site: "Iloilo" });
    expect(input).toEqual(ROWS);
  });
});

describe("matchesQuery", () => {
  const target = row({
    id: "REQ-1051",
    requestor: "Jimera, Arielle",
    site: "Iloilo",
    from: "AGT",
    to: "GLS",
  });

  it("matches an empty or whitespace-only query", () => {
    expect(matchesQuery(target, "")).toBe(true);
    expect(matchesQuery(target, "   ")).toBe(true);
  });

  it.each([
    ["the reference", "1051"],
    ["the requestor's surname", "jimera"],
    ["the requestor's given name", "arielle"],
    ["the site", "iloilo"],
    ["the origin", "agt"],
    ["the destination", "gls"],
  ])("matches on %s", (_label, query) => {
    expect(matchesQuery(target, query)).toBe(true);
  });

  it("ignores case and surrounding space", () => {
    expect(matchesQuery(target, "  JIMERA  ")).toBe(true);
  });

  it("rejects text that is in no field", () => {
    expect(matchesQuery(target, "cebu")).toBe(false);
  });

  // The design joins every field into one string and runs a single indexOf, so
  // a query straddling two fields matches a row where it appears in neither.
  // Both of these hit under that implementation.
  it("does not match text spanning two fields", () => {
    expect(matchesQuery(target, "agt gls")).toBe(false);
    expect(matchesQuery(target, "iloilo agt")).toBe(false);
  });

  it("filters the list by query", () => {
    const visible = filterAdminRequests(ROWS, {
      ...base,
      tab: "all",
      query: "REQ-4",
    });
    expect(visible.map((r) => r.id)).toEqual(["REQ-4"]);
  });

  // Purpose, Details, Driver, Van and Plate Number are all columns on the
  // master list; the client's explicit ask was a driver/plate column so they
  // can find trips, so the search box must reach them too.
  it.each([
    ["the purpose", "onshore"],
    ["the details", "visiting auditor"],
    ["the driver", "villanueva"],
    ["the van label", "van-002"],
    ["the plate", "abc-1234"],
  ])("matches on %s", (_label, query) => {
    const assigned = row({
      purpose: "Onshore/Client Visit",
      details: "Airport pickup for a visiting auditor.",
      driver: "Villanueva, Rey",
      vanLabel: "VAN-002",
      vanPlate: "ABC-1234",
    });
    expect(matchesQuery(assigned, query)).toBe(true);
  });

  it("does not throw when driver, van label and plate are null", () => {
    const unassigned = row({ driver: null, vanLabel: null, vanPlate: null });
    expect(matchesQuery(unassigned, "anything")).toBe(false);
  });
});

describe("pendingCount", () => {
  it("counts every pending request across sites by default", () => {
    expect(pendingCount(ROWS)).toBe(2);
  });

  it("counts pending requests at one site", () => {
    expect(pendingCount(ROWS, "Iloilo")).toBe(1);
    expect(pendingCount(ROWS, "Manila")).toBe(1);
  });

  it("counts nothing when there is nothing pending", () => {
    expect(pendingCount([row({ status: "Approved" })])).toBe(0);
    expect(pendingCount([])).toBe(0);
  });

  // Guards the badge against counting anything that has already been decided.
  it.each(["Approved", "Rejected", "Cancelled"] as const)(
    "does not count a %s request",
    (status) => {
      expect(pendingCount([row({ status })])).toBe(0);
    },
  );
});

describe("status filter", () => {
  it("defaults to everything except Pending", () => {
    expect(blankAdminFilter().statuses).toEqual([
      "Approved",
      "Approved - Driver Reassigned",
      "Rejected",
      "Cancelled",
    ]);
  });

  it("keeps only the selected statuses on the Master List tab", () => {
    const rows = [
      row({ id: "A", status: "Approved" }),
      row({ id: "B", status: "Cancelled" }),
      row({ id: "C", status: "Rejected" }),
    ];
    const visible = filterAdminRequests(rows, {
      ...blankAdminFilter(),
      tab: "all",
      statuses: ["Approved", "Rejected"],
    });
    expect(visible.map((r) => r.id)).toEqual(["A", "C"]);
  });

  // A filter that silently means its own opposite when emptied is the worse
  // reading: an admin who deselects everything and still sees every row will
  // believe the control is broken.
  it("shows nothing when no status is selected", () => {
    const visible = filterAdminRequests([row({ status: "Approved" })], {
      ...blankAdminFilter(),
      tab: "all",
      statuses: [],
    });
    expect(visible).toEqual([]);
  });

  // The Pending tab IS the pending queue. A status filter there could empty the
  // one tab that exists to never be empty.
  it("ignores the status filter on the Pending tab", () => {
    const rows = [row({ id: "A", status: "Pending" })];
    const visible = filterAdminRequests(rows, {
      ...blankAdminFilter(),
      tab: "pending",
      statuses: [],
    });
    expect(visible.map((r) => r.id)).toEqual(["A"]);
  });
});

describe("sortAdminRequests", () => {
  const a = row({
    id: "A",
    submittedAt: "2026-08-01T00:00:00Z",
    updatedAt: null,
  });
  const b = row({
    id: "B",
    submittedAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-05T00:00:00Z",
  });
  const c = row({
    id: "C",
    submittedAt: "2026-08-02T00:00:00Z",
    updatedAt: "2026-08-09T00:00:00Z",
  });

  it("orders by submission, oldest first", () => {
    expect(
      sortAdminRequests([b, c, a], {
        column: "submittedAt",
        direction: "asc",
      }).map((r) => r.id),
    ).toEqual(["A", "C", "B"]);
  });

  it("orders by last update, newest first", () => {
    expect(
      sortAdminRequests([a, b, c], {
        column: "updatedAt",
        direction: "desc",
      }).map((r) => r.id),
    ).toEqual(["C", "B", "A"]);
  });

  // A request nobody has touched is not the least-recently-updated one; it has
  // no answer to the question. Sinking it under desc while floating it under asc
  // would be two different lies.
  it("sinks nulls last in BOTH directions", () => {
    expect(
      sortAdminRequests([a, b, c], {
        column: "updatedAt",
        direction: "asc",
      }).map((r) => r.id),
    ).toEqual(["B", "C", "A"]);
  });

  it("orders status by lifecycle, not alphabetically", () => {
    const rows = [
      row({ id: "X", status: "Rejected" }),
      row({ id: "Y", status: "Approved" }),
      row({ id: "Z", status: "Pending" }),
    ];
    expect(
      sortAdminRequests(rows, { column: "status", direction: "asc" }).map(
        (r) => r.id,
      ),
    ).toEqual(["Z", "Y", "X"]);
  });

  // Ties keep the server's order, which is `created_at desc` — a meaningful
  // fallback rather than an arbitrary one.
  it("is stable across ties", () => {
    const tied = [
      row({ id: "P", status: "Approved" }),
      row({ id: "Q", status: "Approved" }),
      row({ id: "R", status: "Approved" }),
    ];
    expect(
      sortAdminRequests(tied, { column: "status", direction: "asc" }).map(
        (r) => r.id,
      ),
    ).toEqual(["P", "Q", "R"]);
  });

  it("does not mutate its input", () => {
    const rows = [b, a];
    sortAdminRequests(rows, { column: "submittedAt", direction: "asc" });
    expect(rows.map((r) => r.id)).toEqual(["B", "A"]);
  });
});

describe("default sort per tab", () => {
  it("puts the longest-waiting request at the top of the Pending queue", () => {
    expect(blankAdminFilter().sort.pending).toEqual({
      column: "submittedAt",
      direction: "asc",
    });
  });

  it("puts the most recently touched request at the top of the Master List", () => {
    expect(blankAdminFilter().sort.all).toEqual({
      column: "updatedAt",
      direction: "desc",
    });
  });
});

describe("statusBreakdown", () => {
  it("counts each status and the total", () => {
    const { counts, total } = statusBreakdown(ROWS);
    expect(counts).toEqual({
      Pending: 2,
      Approved: 1,
      "Approved - Driver Reassigned": 0,
      Rejected: 1,
      Cancelled: 1,
    });
    expect(total).toBe(5);
  });

  it("keeps every status present at zero rather than omitting it", () => {
    const { counts, total } = statusBreakdown([]);
    expect(Object.keys(counts).sort()).toEqual(
      [...RESERVATION_STATUSES].sort(),
    );
    expect(Object.values(counts)).toEqual(RESERVATION_STATUSES.map(() => 0));
    expect(total).toBe(0);
  });

  it("sums the per-status counts to the total", () => {
    const { counts, total } = statusBreakdown(sampleAdminRequests());
    const summed = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(summed).toBe(total);
  });
});

describe("share", () => {
  it.each([
    [1, 4, "25%"],
    [3, 8, "37.5%"],
    [1, 3, "33.3%"],
    [2, 2, "100%"],
    [0, 7, "0%"],
  ])("renders %i of %i as %s", (count, total, expected) => {
    expect(share(count, total)).toBe(expected);
  });

  // Dividing by zero renders "NaN%", which is what an empty list would show on
  // every row of the breakdown.
  it("renders 0% for an empty total instead of NaN", () => {
    expect(share(0, 0)).toBe("0%");
    expect(share(3, 0)).toBe("0%");
  });

  it("drops a trailing zero decimal", () => {
    expect(share(45, 100)).toBe("45%");
  });
});

describe("tab vocabulary", () => {
  it("labels every tab", () => {
    for (const tab of ADMIN_TABS) {
      expect(ADMIN_TAB_LABELS[tab].trim()).not.toBe("");
    }
  });

  it("defaults to the review queue, not the full history", () => {
    // Admin Support opens this page to act on something. Defaulting to the full
    // master list would bury two pending requests under six settled ones.
    expect(blankAdminFilter()).toEqual({
      tab: "pending",
      site: ALL,
      mode: ALL,
      query: "",
      // Pending is excluded here for the same reason the tab defaults to it:
      // the Master List would otherwise repeat the queue beside it.
      statuses: [
        "Approved",
        "Approved - Driver Reassigned",
        "Rejected",
        "Cancelled",
      ],
      sort: {
        pending: { column: "submittedAt", direction: "asc" },
        all: { column: "updatedAt", direction: "desc" },
      },
    });
  });
});

describe("quartersIn", () => {
  it("derives quarters from the data, newest first, with counts", () => {
    const rows = [
      row({ id: "REQ-1", startDate: "2026-01-15" }),
      row({ id: "REQ-2", startDate: "2026-02-20" }),
      row({ id: "REQ-3", startDate: "2026-04-01" }),
      row({ id: "REQ-4", startDate: "2025-11-30" }),
    ];
    expect(quartersIn(rows)).toEqual([
      { value: "2026-Q2", label: "Q2 2026", count: 1 },
      { value: "2026-Q1", label: "Q1 2026", count: 2 },
      { value: "2025-Q4", label: "Q4 2025", count: 1 },
    ]);
  });

  it("skips rows with unparseable start dates", () => {
    const rows = [
      row({ id: "REQ-1", startDate: "not-a-date" }),
      row({ id: "REQ-2", startDate: "2026-06-05" }),
    ];
    expect(quartersIn(rows)).toEqual([
      { value: "2026-Q2", label: "Q2 2026", count: 1 },
    ]);
  });

  it("returns no quarters for no rows", () => {
    expect(quartersIn([])).toEqual([]);
  });
});

describe("monthsOfQuarter", () => {
  it("returns the quarter's three months with full names", () => {
    expect(monthsOfQuarter("2026-Q1")).toEqual([
      { value: "2026-01", label: "January" },
      { value: "2026-02", label: "February" },
      { value: "2026-03", label: "March" },
    ]);
  });

  it("embeds the year in each month value across quarters", () => {
    expect(monthsOfQuarter("2025-Q4").map((m) => m.value)).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
    ]);
    expect(monthsOfQuarter("2025-Q4").map((m) => m.label)).toEqual([
      "October",
      "November",
      "December",
    ]);
  });

  it("returns nothing for a malformed quarter", () => {
    expect(monthsOfQuarter("2026-Q5")).toEqual([]);
    expect(monthsOfQuarter("garbage")).toEqual([]);
  });
});

describe("filterByQuarter", () => {
  it("keeps only rows whose start month falls in the quarter", () => {
    const rows = [
      row({ id: "REQ-1", startDate: "2026-01-15" }),
      row({ id: "REQ-2", startDate: "2026-03-31" }),
      row({ id: "REQ-3", startDate: "2026-04-01" }),
      row({ id: "REQ-4", startDate: "bad" }),
    ];
    expect(filterByQuarter(rows, "2026-Q1").map((r) => r.id)).toEqual([
      "REQ-1",
      "REQ-2",
    ]);
  });
});
