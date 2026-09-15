import { describe, expect, it } from "vitest";
import {
  APPROVED_STATUSES,
  canRevertNoShow,
  isCancellable,
  isNoShowEligible,
  isReassignable,
  isRequestorEditable,
  RESERVATION_STATUSES,
  type ReservationStatus,
  requestorFacingStatus,
  SCHEDULED_STATUSES,
} from "@/modules/reservations/types";

const REASSIGNED: ReservationStatus = "Approved - Driver Reassigned";
const NO_SHOW: ReservationStatus = "No Show";

describe("reservation status vocabulary", () => {
  it("carries all six statuses in lifecycle order", () => {
    expect([...RESERVATION_STATUSES]).toEqual([
      "Pending",
      "Approved",
      "Approved - Driver Reassigned",
      "No Show",
      "Rejected",
      "Cancelled",
    ]);
  });

  // A set member that is not a real status matches nothing and fails silently
  // — which is exactly how a typo in one of these sets would present.
  it.each([
    ["SCHEDULED_STATUSES", SCHEDULED_STATUSES],
    ["APPROVED_STATUSES", APPROVED_STATUSES],
  ])("%s contains only real statuses", (_label, set) => {
    for (const status of set) {
      expect(RESERVATION_STATUSES).toContain(status);
    }
  });

  it("treats a reassigned trip as scheduled", () => {
    expect(SCHEDULED_STATUSES.has(REASSIGNED)).toBe(true);
    expect(SCHEDULED_STATUSES.has("Rejected")).toBe(false);
    expect(SCHEDULED_STATUSES.has("Cancelled")).toBe(false);
  });

  // The driver and van genuinely turned up, so a no-show still occupies the
  // calendar and still counts toward a driver's workload.
  it("treats a no-show trip as scheduled", () => {
    expect(SCHEDULED_STATUSES.has(NO_SHOW)).toBe(true);
  });

  it("treats a reassigned trip as approved", () => {
    expect(APPROVED_STATUSES.has(REASSIGNED)).toBe(true);
    expect(APPROVED_STATUSES.has("Approved")).toBe(true);
    expect(APPROVED_STATUSES.has("Pending")).toBe(false);
  });

  // No Show is scheduled but not "approved in substance" — reassigning a
  // driver for a trip that already happened makes no sense.
  it("does not treat a no-show trip as approved", () => {
    expect(APPROVED_STATUSES.has(NO_SHOW)).toBe(false);
  });
});

describe("status predicates", () => {
  it("lets a requestor edit only a pending request", () => {
    expect(isRequestorEditable("Pending")).toBe(true);
    for (const status of [
      "Approved",
      REASSIGNED,
      NO_SHOW,
      "Rejected",
      "Cancelled",
    ] as const) {
      expect(isRequestorEditable(status)).toBe(false);
    }
  });

  it("allows cancelling a pending or approved request", () => {
    expect(isCancellable("Pending")).toBe(true);
    expect(isCancellable("Approved")).toBe(true);
    expect(isCancellable(REASSIGNED)).toBe(true);
    expect(isCancellable("Rejected")).toBe(false);
    expect(isCancellable("Cancelled")).toBe(false);
  });

  // Reversing a no-show has its own dedicated door (`canRevertNoShow`), not
  // this one — cancelling a trip that already happened is meaningless.
  it("does not allow cancelling a no-show", () => {
    expect(isCancellable(NO_SHOW)).toBe(false);
  });

  it("allows reassigning only an approved request", () => {
    expect(isReassignable("Approved")).toBe(true);
    expect(isReassignable(REASSIGNED)).toBe(true);
    expect(isReassignable("Pending")).toBe(false);
    expect(isReassignable("Rejected")).toBe(false);
    expect(isReassignable("Cancelled")).toBe(false);
    expect(isReassignable(NO_SHOW)).toBe(false);
  });

  it("allows marking a no-show only on an approved request", () => {
    expect(isNoShowEligible("Approved")).toBe(true);
    expect(isNoShowEligible(REASSIGNED)).toBe(true);
    expect(isNoShowEligible("Pending")).toBe(false);
    expect(isNoShowEligible("Rejected")).toBe(false);
    expect(isNoShowEligible("Cancelled")).toBe(false);
    expect(isNoShowEligible(NO_SHOW)).toBe(false);
  });

  it("allows reverting only a no-show, back to Approved", () => {
    expect(canRevertNoShow(NO_SHOW)).toBe(true);
    for (const status of [
      "Pending",
      "Approved",
      REASSIGNED,
      "Rejected",
      "Cancelled",
    ] as const) {
      expect(canRevertNoShow(status)).toBe(false);
    }
  });
});

describe("requestorFacingStatus", () => {
  it("hides the reassignment from the requestor", () => {
    expect(requestorFacingStatus(REASSIGNED)).toBe("Approved");
  });

  it("passes every other status through unchanged, including No Show", () => {
    for (const status of RESERVATION_STATUSES) {
      if (status === REASSIGNED) continue;
      expect(requestorFacingStatus(status)).toBe(status);
    }
  });
});
