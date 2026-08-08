import { describe, expect, it } from "vitest";
import {
  bookingDraftSchema,
  cancelInputSchema,
  decisionInputSchema,
  MAX_PASSENGERS_PER_TRIP,
  MAX_TRIPS_PER_SUBMISSION,
  parseJsonBody,
} from "@/modules/reservations/wire";

function trip(overrides: Record<string, unknown> = {}) {
  return {
    purpose: "Travel-Related (Airport Transfers)",
    details: "Airport transfer for the site visit.",
    towerHead: "",
    passengers: [{ domainId: "AJ29104", name: "Jimera, Arielle" }],
    pickupDate: "2026-09-01",
    pickupTime: "06:30",
    dropoffPoint: "AGT Building",
    pickupPoint: "GLS Tower lobby",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    ...overrides,
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    mode: "pickup",
    site: "Manila",
    mobile: "09171112222",
    trips: [trip()],
    ...overrides,
  };
}

describe("bookingDraftSchema", () => {
  it("accepts a complete draft", () => {
    expect(bookingDraftSchema.safeParse(draft()).success).toBe(true);
  });

  it("lets an unchosen site through, so the requestor gets a field error", () => {
    // "" is the wizard's not-chosen-yet value. Rejecting it here would answer a
    // missing site with a shape error instead of MESSAGES.siteRequired on the
    // site input — `validateStep` is what refuses it, one layer down.
    expect(bookingDraftSchema.safeParse(draft({ site: "" })).success).toBe(
      true,
    );
  });

  it("rejects a site that is neither", () => {
    expect(bookingDraftSchema.safeParse(draft({ site: "Cebu" })).success).toBe(
      false,
    );
  });

  it("rejects an unknown ride mode", () => {
    expect(
      bookingDraftSchema.safeParse(draft({ mode: "helicopter" })).success,
    ).toBe(false);
  });

  it("drops fields the client invented rather than storing them", () => {
    const parsed = bookingDraftSchema.parse({
      ...draft(),
      requestorUserId: "user-9",
    });
    expect(parsed).not.toHaveProperty("requestorUserId");
  });

  it("requires at least one trip and one passenger", () => {
    expect(bookingDraftSchema.safeParse(draft({ trips: [] })).success).toBe(
      false,
    );
    expect(
      bookingDraftSchema.safeParse(draft({ trips: [trip({ passengers: [] })] }))
        .success,
    ).toBe(false);
  });

  it("caps both arrays, so one request cannot ask for unbounded inserts", () => {
    const trips = Array.from({ length: MAX_TRIPS_PER_SUBMISSION + 1 }, () =>
      trip(),
    );
    expect(bookingDraftSchema.safeParse(draft({ trips })).success).toBe(false);

    const passengers = Array.from(
      { length: MAX_PASSENGERS_PER_TRIP + 1 },
      () => ({ domainId: "AJ29104", name: "Jimera, Arielle" }),
    );
    expect(
      bookingDraftSchema.safeParse(draft({ trips: [trip({ passengers })] }))
        .success,
    ).toBe(false);
  });
});

describe("decisionInputSchema", () => {
  it("requires a version — the concurrency guard is not optional", () => {
    expect(decisionInputSchema.safeParse({ decision: "approve" }).success).toBe(
      false,
    );
  });

  it("fills in the optional half of a bare decision", () => {
    // Both assignment sides default to null — "leave unchanged" — so a save
    // that touches neither says nothing about either.
    expect(decisionInputSchema.parse({ version: 1, decision: null })).toEqual({
      version: 1,
      decision: null,
      rejectionReason: "",
      driver: null,
      van: null,
      trip: null,
    });
  });

  it("rejects a roster reference that is not a uuid", () => {
    for (const side of [
      { driver: { source: "roster", driverId: "Villanueva, Ruel" } },
      { van: { source: "roster", vanId: "VAN-01" } },
    ]) {
      expect(
        decisionInputSchema.safeParse({
          version: 1,
          decision: "approve",
          ...side,
        }).success,
      ).toBe(false);
    }
  });

  it("accepts a rental driver typed in by hand", () => {
    const parsed = decisionInputSchema.safeParse({
      version: 1,
      decision: null,
      driver: { source: "rental", name: "R", mobile: "9171234567" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a rental driver missing the fields that identify them", () => {
    // The pair CHECK constraints only demand that name and mobile travel
    // together, so a half-filled rental has to be refused here.
    expect(
      decisionInputSchema.safeParse({
        version: 1,
        decision: null,
        driver: { source: "rental" },
      }).success,
    ).toBe(false);
    expect(
      decisionInputSchema.safeParse({
        version: 1,
        decision: null,
        driver: { source: "rental", name: "", mobile: "9171234567" },
      }).success,
    ).toBe(false);
  });

  it("defaults a rental van's optional unit number to null", () => {
    const parsed = decisionInputSchema.parse({
      version: 1,
      decision: null,
      van: { source: "rental", plate: "RENT 1", carType: "GL Grandia" },
    });
    expect(parsed.van).toEqual({
      source: "rental",
      vanNumber: null,
      plate: "RENT 1",
      carType: "GL Grandia",
    });
  });

  it("rejects an assignment source it does not know", () => {
    expect(
      decisionInputSchema.safeParse({
        version: 1,
        decision: null,
        van: { source: "borrowed", plate: "RENT 1", carType: "GL" },
      }).success,
    ).toBe(false);
  });

  it("rejects a decision it does not know", () => {
    expect(
      decisionInputSchema.safeParse({ version: 1, decision: "defer" }).success,
    ).toBe(false);
  });
});

describe("cancelInputSchema", () => {
  it("defaults a missing reason to empty", () => {
    expect(cancelInputSchema.parse({})).toEqual({ reason: "" });
  });
});

describe("parseJsonBody", () => {
  const post = (body: string) =>
    new Request("http://localhost/x", { method: "POST", body });

  it("returns null for a body that is not JSON", async () => {
    expect(
      await parseJsonBody(post("{not json"), cancelInputSchema),
    ).toBeNull();
  });

  it("returns null for JSON of the wrong shape", async () => {
    expect(
      await parseJsonBody(post('{"reason":42}'), cancelInputSchema),
    ).toBeNull();
  });

  it("returns the parsed value on a match", async () => {
    expect(
      await parseJsonBody(post('{"reason":"Moved."}'), cancelInputSchema),
    ).toEqual({ reason: "Moved." });
  });
});
