import { describe, expect, it } from "vitest";
import {
  type BookingDraft,
  blankDraft,
  blankTrip,
  isCompleteDomainId,
  isDraftStepValid,
  isValidMobile,
  MESSAGES,
  normalizeMobile,
  type TripDraft,
  validateStep,
} from "@/modules/reservations/draft";
import { TRIP_PURPOSES } from "@/modules/reservations/reference";
import type { RideMode } from "@/modules/reservations/types";

/** A draft that passes every rule, so each test can break exactly one thing. */
function validDraft(mode: RideMode = "pickup"): BookingDraft {
  return {
    mode,
    site: "Manila",
    mobile: "09171234567",
    trips: [validTrip(mode)],
  };
}

function validTrip(mode: RideMode): TripDraft {
  const base: TripDraft = {
    ...blankTrip(),
    purpose: "IT-Related",
    details: "Laptop replacement drop-off.",
    passengers: [{ domainId: "AB12345", name: "Dela Cruz, Juan" }],
  };
  if (mode === "standby") {
    return {
      ...base,
      towerHead: "Cruz, Ivan",
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      startTime: "09:00",
      endTime: "17:00",
      pickupPoint: "GLS Tower lobby",
    };
  }
  return {
    ...base,
    pickupDate: "2026-08-10",
    pickupTime: "09:00",
    pickupPoint: "GLS Tower lobby",
    dropoffPoint: "AGT Building",
  };
}

describe("the fixtures these tests are built on", () => {
  // If this drifts, every "breaks exactly one thing" test below silently starts
  // asserting against an already-invalid draft and passes for the wrong reason.
  it.each(["pickup", "standby"] as const)(
    "a complete %s draft passes every step",
    (mode) => {
      for (const step of [2, 3, 4] as const) {
        expect(isDraftStepValid(validateStep(validDraft(mode), step))).toBe(
          true,
        );
      }
    },
  );

  it("a blank draft fails", () => {
    expect(isDraftStepValid(validateStep(blankDraft("pickup"), 4))).toBe(false);
  });
});

describe("normalizeMobile", () => {
  it.each([
    ["09171234567", "09171234567"],
    ["0917 123 4567", "09171234567"],
    ["0917-123-4567", "09171234567"],
    ["(0917) 123 4567", "09171234567"],
  ])("reduces %s to digits", (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });
});

describe("isValidMobile", () => {
  it.each(["09171234567", "0917 123 4567", "0999 999 9999"])(
    "accepts %s",
    (value) => {
      expect(isValidMobile(value)).toBe(true);
    },
  );

  it.each([
    ["too short", "0917123456"],
    ["too long", "091712345678"],
    ["wrong prefix", "08171234567"],
    ["prefix 9 without leading 0", "9171234567"],
    ["international form", "+639171234567"],
    ["letters", "0917abcdefg"],
    ["empty", ""],
    ["spaces only", "   "],
  ])("refuses %s", (_label, value) => {
    expect(isValidMobile(value)).toBe(false);
  });
});

describe("isCompleteDomainId", () => {
  it("accepts exactly 7 characters", () => {
    expect(isCompleteDomainId("AB12345")).toBe(true);
  });

  it.each([
    ["6 characters", "AB1234"],
    ["8 characters", "AB123456"],
    ["empty", ""],
    ["7 spaces", "       "],
  ])("refuses %s", (_label, value) => {
    expect(isCompleteDomainId(value)).toBe(false);
  });

  it("ignores surrounding whitespace when measuring", () => {
    expect(isCompleteDomainId("  AB12345  ")).toBe(true);
  });
});

describe("step 2 — site and contact details", () => {
  it("requires a site", () => {
    const draft = { ...validDraft(), site: "" as const };
    expect(validateStep(draft, 2).site).toBe(MESSAGES.siteRequired);
  });

  it("distinguishes a missing mobile from a malformed one", () => {
    expect(validateStep({ ...validDraft(), mobile: "" }, 2).mobile).toBe(
      MESSAGES.mobileRequired,
    );
    expect(validateStep({ ...validDraft(), mobile: "0917" }, 2).mobile).toBe(
      MESSAGES.mobileFormat,
    );
  });

  // A mobile of "   " normalizes to "" — it must read as absent, not as a
  // format error, or the message tells the user to fix digits they never typed.
  it("treats a whitespace-only mobile as missing", () => {
    expect(validateStep({ ...validDraft(), mobile: "   " }, 2).mobile).toBe(
      MESSAGES.mobileRequired,
    );
  });

  it("ignores trip problems while on step 2", () => {
    const draft = validDraft();
    draft.trips[0].purpose = "";
    expect(validateStep(draft, 2).trips[0].purpose).toBeUndefined();
  });
});

describe("step 3 — trip details", () => {
  it("requires a purpose", () => {
    const draft = validDraft();
    draft.trips[0].purpose = "";
    expect(validateStep(draft, 3).trips[0].purpose).toBe(
      MESSAGES.purposeRequired,
    );
  });

  // The gap this closes: validateStep only checked non-empty, so a crafted
  // body stored any string and the eighteen options were a UI suggestion.
  it("refuses a purpose outside the closed set", () => {
    const draft = validDraft();
    draft.trips[0].purpose = "Weekend Beach Trip";
    expect(validateStep(draft, 3).trips[0].purpose).toBe(
      MESSAGES.purposeUnknown,
    );
  });

  // Details is required for every purpose, not only "Others" — the client's
  // admin wants context on every booking.
  it("requires details for every purpose, not only Others", () => {
    for (const purpose of TRIP_PURPOSES) {
      const draft = validDraft();
      draft.trips[0].purpose = purpose;
      draft.trips[0].details = "";
      expect(validateStep(draft, 3).trips[0].details).toBe(
        MESSAGES.detailsRequired,
      );
    }
  });

  it("rejects whitespace-only details", () => {
    const draft = validDraft();
    draft.trips[0].details = "   ";
    expect(validateStep(draft, 3).trips[0].details).toBe(
      MESSAGES.detailsRequired,
    );
  });

  it("accepts real details", () => {
    const draft = validDraft();
    draft.trips[0].details = "Offsite at Punta Villa.";
    expect(validateStep(draft, 3).trips[0].details).toBeUndefined();
  });

  it("requires a tower head for standby only", () => {
    const standby = validDraft("standby");
    standby.trips[0].towerHead = "";
    expect(validateStep(standby, 3).trips[0].towerHead).toBe(
      MESSAGES.towerRequired,
    );

    // The pickup flow never shows the field, so demanding it would deadlock the
    // wizard on a control the requestor cannot see.
    const pickup = validDraft("pickup");
    pickup.trips[0].towerHead = "";
    expect(validateStep(pickup, 3).trips[0].towerHead).toBeUndefined();
  });

  it("flags the specific passenger row that is wrong", () => {
    const draft = validDraft();
    draft.trips[0].passengers = [
      { domainId: "AB12345", name: "Dela Cruz, Juan" },
      { domainId: "SHORT", name: "Reyes, Ana" },
      { domainId: "CD67890", name: "" },
    ];
    const rows = validateStep(draft, 3).trips[0].passengerRows;

    expect(rows[0]).toEqual({ domainId: false, name: false });
    expect(rows[1]).toEqual({ domainId: true, name: false });
    expect(rows[2]).toEqual({ domainId: false, name: true });
    expect(validateStep(draft, 3).trips[0].passengers).toBe(
      MESSAGES.passengersIncomplete,
    );
  });

  it("validates every trip independently, not just the first", () => {
    const draft = validDraft();
    draft.trips = [
      validTrip("pickup"),
      { ...validTrip("pickup"), purpose: "" },
    ];
    const errors = validateStep(draft, 3);

    expect(errors.trips[0].purpose).toBeUndefined();
    expect(errors.trips[1].purpose).toBe(MESSAGES.purposeRequired);
  });

  describe("required schedule fields", () => {
    it.each([
      "pickupDate",
      "pickupTime",
      "pickupPoint",
      "dropoffPoint",
    ] as const)("marks a missing %s on a pickup trip", (field) => {
      const draft = validDraft("pickup");
      draft.trips[0][field] = "";
      const trip = validateStep(draft, 3).trips[0];

      expect(trip.missing[field]).toBe(true);
      expect(trip.schedule).toBe(MESSAGES.scheduleIncomplete);
    });

    it.each([
      "startDate",
      "endDate",
      "startTime",
      "endTime",
      "pickupPoint",
    ] as const)("marks a missing %s on a standby trip", (field) => {
      const draft = validDraft("standby");
      draft.trips[0][field] = "";
      const trip = validateStep(draft, 3).trips[0];

      expect(trip.missing[field]).toBe(true);
      expect(trip.schedule).toBe(MESSAGES.scheduleIncomplete);
    });

    // The design document tests falsiness, so "   " passes its check and a
    // request reaches Admin Support with a blank pickup point that renders as an
    // empty cell in the dispatch table.
    it.each(["pickupPoint", "dropoffPoint"] as const)(
      "treats a whitespace-only %s as missing",
      (field) => {
        const draft = validDraft("pickup");
        draft.trips[0][field] = "     ";
        expect(validateStep(draft, 3).trips[0].missing[field]).toBe(true);
      },
    );

    it("does not demand pickup fields on a standby trip", () => {
      const draft = validDraft("standby");
      const trip = validateStep(draft, 3).trips[0];
      expect(trip.missing.pickupDate).toBeUndefined();
      expect(trip.missing.dropoffPoint).toBeUndefined();
    });
  });

  describe("the standby window must be a real interval", () => {
    it("refuses an end date before the start date", () => {
      const draft = validDraft("standby");
      draft.trips[0].startDate = "2026-08-11";
      draft.trips[0].endDate = "2026-08-10";
      expect(validateStep(draft, 3).trips[0].schedule).toBe(
        MESSAGES.endDateBeforeStart,
      );
    });

    it("allows a single-day window", () => {
      const draft = validDraft("standby");
      draft.trips[0].startDate = "2026-08-10";
      draft.trips[0].endDate = "2026-08-10";
      expect(isDraftStepValid(validateStep(draft, 3))).toBe(true);
    });

    // Not in the design document, which validates no times at all: on a
    // same-day window it accepts 17:00 → 09:00, a negative eight-hour booking
    // that a driver then gets dispatched against.
    it.each([
      ["end before start", "17:00", "09:00"],
      ["end equal to start", "09:00", "09:00"],
    ])("refuses a same-day window with %s", (_label, start, end) => {
      const draft = validDraft("standby");
      draft.trips[0].startDate = "2026-08-10";
      draft.trips[0].endDate = "2026-08-10";
      draft.trips[0].startTime = start;
      draft.trips[0].endTime = end;
      const trip = validateStep(draft, 3).trips[0];

      expect(trip.schedule).toBe(MESSAGES.endTimeNotAfterStart);
      expect(trip.missing.startTime).toBe(true);
      expect(trip.missing.endTime).toBe(true);
    });

    // Across two days an end time earlier on the clock is completely normal —
    // 22:00 on Monday to 06:00 on Tuesday is an overnight standby.
    it("allows an earlier end time when the window spans two days", () => {
      const draft = validDraft("standby");
      draft.trips[0].startDate = "2026-08-10";
      draft.trips[0].endDate = "2026-08-11";
      draft.trips[0].startTime = "22:00";
      draft.trips[0].endTime = "06:00";
      expect(isDraftStepValid(validateStep(draft, 3))).toBe(true);
    });

    it("reports the missing field rather than a bogus ordering when a date is blank", () => {
      const draft = validDraft("standby");
      draft.trips[0].endDate = "";
      const trip = validateStep(draft, 3).trips[0];

      expect(trip.missing.endDate).toBe(true);
      expect(trip.schedule).toBe(MESSAGES.scheduleIncomplete);
    });
  });
});

describe("step 4 — review re-runs everything", () => {
  // A requestor can reach Review, go back, blank a required field, and return.
  // Submitting whatever is on screen at that point is how a half-filled request
  // reaches Admin Support, so step 4 re-checks both earlier steps.
  it("catches a step 2 problem from step 4", () => {
    const draft = { ...validDraft(), mobile: "" };
    expect(validateStep(draft, 4).mobile).toBe(MESSAGES.mobileRequired);
    expect(isDraftStepValid(validateStep(draft, 4))).toBe(false);
  });

  it("catches a step 3 problem from step 4", () => {
    const draft = validDraft();
    draft.trips[0].purpose = "";
    expect(validateStep(draft, 4).trips[0].purpose).toBe(
      MESSAGES.purposeRequired,
    );
    expect(isDraftStepValid(validateStep(draft, 4))).toBe(false);
  });

  // Pins `isDraftStepValid`'s `trip.details === undefined` check directly:
  // every other field stays valid, so this can only fail for one reason.
  it("catches a blank details from step 4, with every other field valid", () => {
    const draft = validDraft();
    draft.trips[0].details = "";
    expect(validateStep(draft, 4).trips[0].details).toBe(
      MESSAGES.detailsRequired,
    );
    expect(isDraftStepValid(validateStep(draft, 4))).toBe(false);
  });
});

describe("isDraftStepValid", () => {
  it("returns an errors object shaped to the trip list even when clean", () => {
    const draft = validDraft();
    draft.trips = [validTrip("pickup"), validTrip("pickup")];
    const errors = validateStep(draft, 3);

    // The wizard indexes errors.trips[i] while rendering, so a short array is a
    // crash, not a missing message.
    expect(errors.trips).toHaveLength(2);
    expect(isDraftStepValid(errors)).toBe(true);
  });

  it("keeps passengerRows aligned with the passenger list", () => {
    const draft = validDraft();
    draft.trips[0].passengers = [
      { domainId: "AB12345", name: "A" },
      { domainId: "CD67890", name: "B" },
      { domainId: "EF11111", name: "C" },
    ];
    expect(validateStep(draft, 3).trips[0].passengerRows).toHaveLength(3);
  });
});
