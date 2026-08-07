import { describe, expect, it } from "vitest";
import {
  APPROVED_STATUSES,
  isCancellable,
  isReassignable,
  isRequestorEditable,
  RESERVATION_STATUSES,
  type ReservationStatus,
  requestorFacingStatus,
  SCHEDULED_STATUSES,
} from "@/modules/reservations/types";

const REASSIGNED: ReservationStatus = "Approved - Driver Reassigned";

describe("reservation status vocabulary", () => {
  it("carries all five statuses in lifecycle order", () => {
    expect([...RESERVATION_STATUSES]).toEqual([
      "Pending",
      "Approved",
      "Approved - Driver Reassigned",
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

  it("treats a reassigned trip as approved", () => {
    expect(APPROVED_STATUSES.has(REASSIGNED)).toBe(true);
    expect(APPROVED_STATUSES.has("Approved")).toBe(true);
    expect(APPROVED_STATUSES.has("Pending")).toBe(false);
  });
});

describe("status predicates", () => {
  it("lets a requestor edit only a pending request", () => {
    expect(isRequestorEditable("Pending")).toBe(true);
    for (const status of [
      "Approved",
      REASSIGNED,
      "Rejected",
      "Cancelled",
    ] as const) {
      expect(isRequestorEditable(status)).toBe(false);
    }
  });

  it("allows cancelling every live status", () => {
    expect(isCancellable("Pending")).toBe(true);
    expect(isCancellable("Approved")).toBe(true);
    expect(isCancellable(REASSIGNED)).toBe(true);
    expect(isCancellable("Rejected")).toBe(false);
    expect(isCancellable("Cancelled")).toBe(false);
  });

  it("allows reassigning only an approved request", () => {
    expect(isReassignable("Approved")).toBe(true);
    expect(isReassignable(REASSIGNED)).toBe(true);
    expect(isReassignable("Pending")).toBe(false);
    expect(isReassignable("Rejected")).toBe(false);
    expect(isReassignable("Cancelled")).toBe(false);
  });
});

describe("requestorFacingStatus", () => {
  it("hides the reassignment from the requestor", () => {
    expect(requestorFacingStatus(REASSIGNED)).toBe("Approved");
  });

  it("passes every other status through unchanged", () => {
    for (const status of RESERVATION_STATUSES) {
      if (status === REASSIGNED) continue;
      expect(requestorFacingStatus(status)).toBe(status);
    }
  });
});
