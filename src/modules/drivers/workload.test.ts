import { describe, expect, it } from "vitest";
import { type Driver, WEEKLY_HOURS_CAP } from "@/modules/drivers/types";
import {
  type DriverWorkload,
  type WorkloadSubject,
  weeklyWorkload,
} from "@/modules/drivers/workload";
import type { ReservationRow } from "@/modules/reservations/types";
import { sampleDrivers } from "@/test-fixtures/drivers";

const WEEK = "2026-08-03";

function driver(overrides: Partial<Driver> & { name: string }): Driver {
  return {
    id: `DRV-${overrides.name}`,
    mobile: "09171234567",
    site: "Manila",
    shift: "11AM-11PM",
    active: true,
    ...overrides,
  };
}

function row(overrides: Partial<ReservationRow> & { id: string }) {
  return {
    submittedAt: "2026-08-01T00:00:00Z",
    startDate: "2026-08-03",
    startTime: "09:00",
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
    updatedAt: "2026-08-04T09:20:00Z",
    remarks: null,
    driver: "Rey",
    driverId: "DRV-Rey",
    driverSource: "roster",
    vanLabel: "VAN-01",
    vanSource: "roster",
    vanPlate: "ABC-1234",
    ...overrides,
  } satisfies ReservationRow;
}

const REY = driver({ name: "Rey" });
const SAM = driver({ name: "Sam" });

/** The subject's display name, whichever kind it is. */
function subjectName(subject: WorkloadSubject): string {
  return subject.kind === "roster" ? subject.driver.name : subject.name;
}

function findRoster(
  workloads: DriverWorkload[],
  driverId: string,
): DriverWorkload | undefined {
  return workloads.find(
    (w) => w.subject.kind === "roster" && w.subject.driver.id === driverId,
  );
}

describe("weeklyWorkload", () => {
  it("lists every driver, including one carrying nothing", () => {
    // A driver who disappears when idle is invisible exactly when an admin is
    // looking for someone free.
    const { workloads } = weeklyWorkload([REY, SAM], [row({ id: "A" })], WEEK);
    expect(workloads.map((w) => subjectName(w.subject)).sort()).toEqual([
      "Rey",
      "Sam",
    ]);
    expect(
      workloads.find((w) => subjectName(w.subject) === "Sam"),
    ).toMatchObject({
      trips: 0,
      minutes: 0,
      hours: 0,
      over: false,
    });
  });

  it("counts a driver's trips in the week", () => {
    const { workloads } = weeklyWorkload(
      [REY],
      [
        row({ id: "A", startDate: "2026-08-03" }),
        row({ id: "B", startDate: "2026-08-07" }),
        row({ id: "C", startDate: "2026-08-09" }),
      ],
      WEEK,
    );
    expect(workloads[0].trips).toBe(3);
  });

  it("ignores a trip outside the week", () => {
    const { workloads } = weeklyWorkload(
      [REY],
      [
        row({ id: "in", startDate: "2026-08-09" }),
        row({ id: "out", startDate: "2026-08-10" }),
        row({ id: "before", startDate: "2026-08-02" }),
      ],
      WEEK,
    );
    expect(workloads[0].trips).toBe(1);
  });

  it("sums standby hours from the real window", () => {
    const { workloads } = weeklyWorkload(
      [REY],
      [
        row({
          id: "A",
          mode: "standby",
          startTime: "07:00",
          endTime: "17:00",
        }),
      ],
      WEEK,
    );
    expect(workloads[0].minutes).toBe(600);
    expect(workloads[0].hours).toBe(10);
  });

  it("gives a pickup the same default block the calendar draws", () => {
    const { workloads } = weeklyWorkload([REY], [row({ id: "A" })], WEEK);
    expect(workloads[0].minutes).toBe(30);
    expect(workloads[0].hours).toBe(0.5);
  });

  it.each(["Cancelled", "Rejected"] as const)(
    "does not charge a driver for a %s trip",
    (status) => {
      const { workloads } = weeklyWorkload(
        [REY],
        [row({ id: "A", status })],
        WEEK,
      );
      expect(workloads[0].trips).toBe(0);
    },
  );

  it("charges a pending trip, because it still holds the slot", () => {
    const { workloads } = weeklyWorkload(
      [REY],
      [row({ id: "A", status: "Pending" })],
      WEEK,
    );
    expect(workloads[0].trips).toBe(1);
  });

  it("keys totals by driver id, not name", () => {
    // Two drivers sharing a name must not merge into one row.
    const drivers = [
      driver({ id: "d1", name: "Ian Aduana" }),
      driver({ id: "d2", name: "Ian Aduana" }),
    ];
    const { workloads } = weeklyWorkload(
      drivers,
      [row({ id: "A", driverId: "d1", driver: "Ian Aduana" })],
      WEEK,
    );
    expect(findRoster(workloads, "d1")?.trips).toBe(1);
    expect(findRoster(workloads, "d2")?.trips).toBe(0);
  });

  it("lists the distinct vans a driver drove that week", () => {
    const { workloads } = weeklyWorkload(
      [REY],
      [
        row({ id: "A", vanLabel: "VAN-001", startDate: "2026-08-03" }),
        row({ id: "B", vanLabel: "VAN-003", startDate: "2026-08-04" }),
        row({ id: "C", vanLabel: "VAN-001", startDate: "2026-08-05" }),
      ],
      WEEK,
    );
    expect(workloads[0].vans).toEqual(["VAN-001", "VAN-003"]);
  });

  it("dedupes vans on the (vanSource, vanLabel) pair, not the label alone", () => {
    // A rental's van number can collide with a roster van's label by
    // coincidence; treating them as the same van would hide that swap.
    const { workloads } = weeklyWorkload(
      [REY],
      [
        row({
          id: "A",
          vanLabel: "VAN-01",
          vanSource: "roster",
          startDate: "2026-08-03",
        }),
        row({
          id: "B",
          vanLabel: "VAN-01",
          vanSource: "rental",
          startDate: "2026-08-04",
        }),
      ],
      WEEK,
    );
    expect(workloads[0].vans).toEqual(["VAN-01", "VAN-01"]);
  });

  it("groups rental drivers into their own rows with no load", () => {
    const { workloads } = weeklyWorkload(
      [],
      [
        row({
          id: "A",
          driverId: null,
          driver: "Rental Ramos",
          driverSource: "rental",
          startDate: "2026-08-03",
        }),
        row({
          id: "B",
          driverId: null,
          driver: "Rental Ramos",
          driverSource: "rental",
          startDate: "2026-08-04",
        }),
      ],
      WEEK,
    );
    expect(workloads).toHaveLength(1);
    expect(workloads[0].subject).toEqual({
      kind: "rental",
      name: "Rental Ramos",
    });
    expect(workloads[0].trips).toBe(2);
    // WEEKLY_HOURS_CAP is a staffing rule for employees. Drawing a 40h bar
    // for a contractor would assert something untrue.
    expect(workloads[0].load).toBeNull();
    expect(workloads[0].over).toBe(false);
  });

  it("still counts a genuinely driverless trip as unassigned", () => {
    const { unassignedTrips } = weeklyWorkload(
      [],
      [
        row({
          id: "A",
          driverId: null,
          driver: null,
          driverSource: null,
          startDate: "2026-08-03",
        }),
      ],
      WEEK,
    );
    expect(unassignedTrips).toBe(1);
  });
});

describe("weeklyWorkload load and cap", () => {
  const longTrip = (id: string, hours: number) =>
    row({
      id,
      mode: "standby",
      startTime: "06:00",
      endTime: `${String(6 + hours).padStart(2, "0")}:00`,
    });

  it("reports load as a fraction of the weekly cap", () => {
    const { workloads } = weeklyWorkload(
      [REY],
      [longTrip("A", 10), { ...longTrip("B", 10), startDate: "2026-08-04" }],
      WEEK,
    );
    expect(workloads[0].hours).toBe(20);
    expect(workloads[0].load).toBeCloseTo(0.5);
    expect(workloads[0].over).toBe(false);
  });

  // Not clamped: a driver at 120% of the cap must be visibly over it, and a bar
  // pinned to 100% shows the same thing as one exactly at the limit.
  it("does not clamp load at the cap", () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      ...longTrip(`T${index}`, 10),
      startDate: `2026-08-0${3 + index}`,
    }));
    const { workloads } = weeklyWorkload([REY], rows, WEEK);
    expect(workloads[0].hours).toBe(50);
    expect(workloads[0].load).toBeGreaterThan(1);
    expect(workloads[0].over).toBe(true);
  });

  it("is not over at exactly the cap", () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({
      ...longTrip(`T${index}`, 10),
      startDate: `2026-08-0${3 + index}`,
    }));
    const { workloads } = weeklyWorkload([REY], rows, WEEK);
    expect(workloads[0].hours).toBe(WEEKLY_HOURS_CAP);
    expect(workloads[0].over).toBe(false);
  });
});

describe("weeklyWorkload unassigned trips", () => {
  it("counts trips with no driver", () => {
    const { unassignedTrips } = weeklyWorkload(
      [REY],
      [
        row({
          id: "A",
          driverId: null,
          driver: null,
          driverSource: null,
          status: "Pending",
        }),
        row({
          id: "B",
          driverId: null,
          driver: null,
          driverSource: null,
          status: "Pending",
        }),
        row({ id: "C" }),
      ],
      WEEK,
    );
    expect(unassignedTrips).toBe(2);
  });

  it("does not count an unassigned trip against any driver", () => {
    const { workloads } = weeklyWorkload(
      [REY],
      [
        row({
          id: "A",
          driverId: null,
          driver: null,
          driverSource: null,
          status: "Pending",
        }),
      ],
      WEEK,
    );
    expect(workloads[0].trips).toBe(0);
  });

  // A row naming a driver id who is not on the roster would otherwise conjure
  // a driver row with no contact details and no van.
  it("ignores a trip naming a driver who is not on the roster", () => {
    const { workloads, unassignedTrips } = weeklyWorkload(
      [REY],
      [row({ id: "A", driverId: "ghost-id", driver: "Ghost, Casper" })],
      WEEK,
    );
    expect(workloads).toHaveLength(1);
    expect(workloads[0].trips).toBe(0);
    expect(unassignedTrips).toBe(0);
  });
});

describe("weeklyWorkload ordering", () => {
  it("puts the busiest driver first", () => {
    const busy = row({
      id: "A",
      mode: "standby",
      startTime: "06:00",
      endTime: "16:00",
      driver: "Sam",
      driverId: SAM.id,
    });
    const { workloads } = weeklyWorkload(
      [REY, SAM],
      [busy, row({ id: "B", driver: "Rey", driverId: REY.id })],
      WEEK,
    );
    expect(workloads.map((w) => subjectName(w.subject))).toEqual([
      "Sam",
      "Rey",
    ]);
  });

  it("breaks a tie by name so the order is stable between renders", () => {
    const { workloads } = weeklyWorkload([SAM, REY], [], WEEK);
    expect(workloads.map((w) => subjectName(w.subject))).toEqual([
      "Rey",
      "Sam",
    ]);
  });
});

describe("with the dev fixtures", () => {
  it("charges the two drivers the reservation fixture assigns", () => {
    // Aug 3–9 2026 contains REQ-1049 (Rey, pickup) and REQ-1038 (Dennis,
    // standby 10:00–13:00).
    const { workloads } = weeklyWorkload(
      sampleDrivers(),
      [
        row({
          id: "REQ-1049",
          startDate: "2026-08-07",
          driver: "Villanueva, Rey",
          driverId: "DRV-01",
        }),
        row({
          id: "REQ-1038",
          startDate: "2026-08-09",
          mode: "standby",
          startTime: "10:00",
          endTime: "13:00",
          driver: "Ocampo, Dennis",
          driverId: "DRV-02",
        }),
      ],
      WEEK,
    );
    const byName = new Map(workloads.map((w) => [subjectName(w.subject), w]));
    expect(byName.get("Ocampo, Dennis")?.hours).toBe(3);
    expect(byName.get("Villanueva, Rey")?.hours).toBe(0.5);
    expect(byName.get("Aguilar, Ben")?.trips).toBe(0);
  });

  it("returns a row for every driver on the roster", () => {
    const drivers = sampleDrivers();
    const { workloads } = weeklyWorkload(drivers, [], WEEK);
    expect(workloads).toHaveLength(drivers.length);
  });
});
