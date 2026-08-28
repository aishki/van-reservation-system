import { describe, expect, it } from "vitest";
import type { ReservationRow } from "@/modules/reservations/types";
import {
  reservationDetailFrom,
  sampleAdminRequests,
  sampleReservationDetail,
} from "@/test-fixtures/reservations";

/**
 * The fixture's own derivation, not the app's. Worth pinning because the drawer
 * tests are built on it: a fixture that renders a rental as a roster van with
 * an invented id would have every drawer test agreeing with the wrong thing.
 */
function row(overrides: Partial<ReservationRow> = {}): ReservationRow {
  return {
    id: "REQ-9001",
    submittedAt: "2026-08-01T00:00:00Z",
    startDate: "2026-08-10",
    startTime: "09:00",
    endTime: null,
    requestor: "Jimera, Arielle",
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
  };
}

describe("reservationDetailFrom", () => {
  it("tags a rental driver as a rental, with no roster id", () => {
    const detail = reservationDetailFrom(
      row({ driver: "Rental Ramos", driverId: null, driverSource: "rental" }),
    );

    // Branching on driverId instead of driverSource rendered this driverless.
    expect(detail.assignedDriver).toEqual({
      source: "rental",
      name: "Rental Ramos",
      mobile: "09171234567",
    });
  });

  it("tags a rental van as a rental, inventing no id and no fleet number", () => {
    const detail = reservationDetailFrom(
      row({ vanLabel: "RENT 0007", vanSource: "rental" }),
    );

    expect(detail.assignedVan).toEqual({
      source: "rental",
      vanNumber: null,
      plate: "RENT 0007",
      carType: "Toyota GL",
    });
  });

  it("keeps a roster assignment on the row's own id", () => {
    const detail = reservationDetailFrom(
      row({
        driver: "Villanueva, Rey",
        driverId: "driver-villanueva-rey",
        driverSource: "roster",
        vanLabel: "VAN-01",
        vanSource: "roster",
      }),
    );

    expect(detail.assignedDriver).toMatchObject({
      source: "roster",
      id: "driver-villanueva-rey",
      name: "Villanueva, Rey",
    });
    expect(detail.assignedVan).toMatchObject({
      source: "roster",
      vanNumber: "VAN-01",
    });
  });

  it("leaves both unions null when nothing is assigned", () => {
    const detail = reservationDetailFrom(row());

    expect(detail.assignedDriver).toBeNull();
    expect(detail.assignedVan).toBeNull();
  });
});

describe("sampleReservationDetail", () => {
  it("returns null for an unknown reference", () => {
    expect(sampleReservationDetail("REQ-0000")).toBeNull();
  });

  it("derives the same detail the row-level helper does", () => {
    const [first] = sampleAdminRequests();
    expect(sampleReservationDetail(first.id)).toEqual(
      reservationDetailFrom(first),
    );
  });

  // Every sample row states where its assignment came from, so nothing in the
  // set silently falls through the source branches above.
  it("gives every sample row a source exactly when it has an assignment", () => {
    for (const sample of sampleAdminRequests()) {
      expect(sample.driverSource === null).toBe(sample.driver === null);
      expect(sample.vanSource === null).toBe(sample.vanLabel === null);
    }
  });
});
