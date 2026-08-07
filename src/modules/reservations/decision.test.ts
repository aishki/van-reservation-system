import { describe, expect, it } from "vitest";
import {
  DECISION_LABELS,
  DECISION_MESSAGES,
  DECISIONS,
  type DecisionDraft,
  isDecisionValid,
  saveLabelFor,
  validateDecision,
  validateDecisionInput,
} from "@/modules/reservations/decision";

function draft(overrides: Partial<DecisionDraft> = {}): DecisionDraft {
  return {
    decision: null,
    rejectionReason: "",
    driverName: "",
    vanName: "",
    ...overrides,
  };
}

describe("validateDecision", () => {
  it("accepts a field-only save with no decision", () => {
    // Editing trip details without approving or rejecting is a legal action —
    // the design's "Trip details changed" checkbox exists for exactly this.
    const errors = validateDecision(draft());
    expect(errors).toEqual({});
    expect(isDecisionValid(errors)).toBe(true);
  });

  describe("rejecting", () => {
    it("requires a reason", () => {
      const errors = validateDecision(draft({ decision: "reject" }));
      expect(errors.rejectionReason).toBe(DECISION_MESSAGES.reasonRequired);
      expect(isDecisionValid(errors)).toBe(false);
    });

    // The design tests `!reason.trim()` here and gets this right; the same file
    // tests plain falsiness elsewhere. Pinned so it cannot regress into the
    // other spelling: a reason of "   " reaches the requestor's rejection email
    // as a blank explanation.
    it("does not accept a whitespace-only reason", () => {
      const errors = validateDecision(
        draft({ decision: "reject", rejectionReason: "   \n\t " }),
      );
      expect(errors.rejectionReason).toBe(DECISION_MESSAGES.reasonRequired);
    });

    it("accepts a real reason", () => {
      const errors = validateDecision(
        draft({ decision: "reject", rejectionReason: "No van available." }),
      );
      expect(isDecisionValid(errors)).toBe(true);
    });

    it("does not ask for a driver or a van when rejecting", () => {
      const errors = validateDecision(
        draft({ decision: "reject", rejectionReason: "No van." }),
      );
      expect(errors.driverName).toBeUndefined();
      expect(errors.van).toBeUndefined();
    });
  });

  describe("approving", () => {
    // FR-13 and the schema's CHECK (status <> 'approved' OR assigned_driver_id
    // IS NOT NULL). The design's drawer offers no such check, so approving with
    // the Driver field on its "Not assigned yet" placeholder produces a write
    // the database refuses — a 500 where a field error belonged.
    it("requires an assigned driver", () => {
      const errors = validateDecision(draft({ decision: "approve" }));
      expect(errors.driverName).toBe(DECISION_MESSAGES.driverRequired);
      expect(isDecisionValid(errors)).toBe(false);
    });

    it("does not accept a whitespace-only driver name", () => {
      const errors = validateDecision(
        draft({ decision: "approve", driverName: "  " }),
      );
      expect(errors.driverName).toBe(DECISION_MESSAGES.driverRequired);
    });

    // `reservations_approved_van_check` is a SEPARATE constraint from the
    // driver's, because van and driver are assigned independently — a trip can
    // hold one without the other right up to approval.
    it("requires a van before approving", () => {
      const errors = validateDecision(
        draft({ decision: "approve", driverName: "Villanueva, Rey" }),
      );
      expect(errors.van).toBe(DECISION_MESSAGES.vanRequired);
      expect(isDecisionValid(errors)).toBe(false);
    });

    it("names both sides when neither is assigned", () => {
      const errors = validateDecision(draft({ decision: "approve" }));
      expect(errors.driverName).toBe(DECISION_MESSAGES.driverRequired);
      expect(errors.van).toBe(DECISION_MESSAGES.vanRequired);
    });

    it("accepts an approval once a driver and a van are assigned", () => {
      const errors = validateDecision(
        draft({
          decision: "approve",
          driverName: "Villanueva, Rey",
          vanName: "VAN-01",
        }),
      );
      expect(errors).toEqual({});
      expect(isDecisionValid(errors)).toBe(true);
    });

    it("does not ask for a rejection reason when approving", () => {
      const errors = validateDecision(
        draft({
          decision: "approve",
          driverName: "Villanueva, Rey",
          vanName: "VAN-01",
        }),
      );
      expect(errors.rejectionReason).toBeUndefined();
    });
  });

  it("does not require a driver or a van for a field-only save", () => {
    // Otherwise an admin could never save a correction to a request they are
    // not yet ready to approve.
    expect(isDecisionValid(validateDecision(draft()))).toBe(true);
  });
});

describe("validateDecisionInput", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({
    decision: null,
    rejectionReason: "",
    driver: null,
    van: null,
    ...overrides,
  });

  it("accepts a rental van as a van", () => {
    // Presence is the rule, not the source: `reservations_approved_van_check`
    // is satisfied by either column.
    const errors = validateDecisionInput(
      input({
        decision: "approve",
        driver: { source: "roster", driverId: "d1" },
        van: {
          source: "rental",
          vanNumber: null,
          plate: "RENT 1",
          carType: "GL",
        },
      }),
    );
    expect(isDecisionValid(errors)).toBe(true);
  });

  it("accepts a rental driver in a roster van — the sides are independent", () => {
    const errors = validateDecisionInput(
      input({
        decision: "approve",
        driver: { source: "rental", name: "Ramos, Ben", mobile: "9171234567" },
        van: { source: "roster", vanId: "v1" },
      }),
    );
    expect(isDecisionValid(errors)).toBe(true);
  });

  it("reads a null side as unassigned, not as satisfied", () => {
    // `null` means "leave unchanged", which on an unassigned request is nothing
    // — so the drawer must round-trip an existing assignment rather than omit it.
    const errors = validateDecisionInput(
      input({
        decision: "approve",
        driver: { source: "roster", driverId: "d1" },
      }),
    );
    expect(errors.van).toBe(DECISION_MESSAGES.vanRequired);
    expect(errors.driverName).toBeUndefined();
  });
});

describe("saveLabelFor", () => {
  it.each([
    ["approve", "Approve & Save"],
    ["reject", "Reject & Save"],
  ] as const)("names the consequence for %s", (decision, expected) => {
    expect(saveLabelFor(decision)).toBe(expected);
  });

  it("falls back to a neutral label with no decision", () => {
    expect(saveLabelFor(null)).toBe("Save changes");
  });
});

describe("decision vocabulary", () => {
  it("labels every decision", () => {
    for (const decision of DECISIONS) {
      expect(DECISION_LABELS[decision].trim()).not.toBe("");
    }
  });
});
