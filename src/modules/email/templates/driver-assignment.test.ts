import { describe, expect, it } from "vitest";
import { EM_DASH } from "@/lib/tz";
import {
  type DriverAssignmentInput,
  renderDriverAssignment,
} from "@/modules/email/templates/driver-assignment";
import type { RequestTrip } from "@/modules/email/templates/request-information";

const trip: RequestTrip = {
  mode: "pickup",
  referenceId: "VR-1042",
  purpose: "Client visit",
  details: "Quarterly review with the account team.",
  pickup: "Aug 10 2026 · 7:30 AM",
  pickupPoint: "Smallville",
  dropoffPoint: "CGS Office",
  passengers: [{ name: "Juan Cruz", domainId: "AB12345" }],
  driver: { name: "Rico Santos", mobile: "0917 555 0100", plate: "ABC 1234" },
};

const input: DriverAssignmentInput = {
  site: "Iloilo",
  rideMode: "Pickup / Drop-Off",
  requestor: {
    name: "Juan Cruz",
    email: "juan@example.invalid",
    mobile: "09171234567",
  },
  manageUrl: "http://localhost:3000/manage",
  change: "assigned",
  trips: [trip],
};

describe("renderDriverAssignment", () => {
  it("distinguishes a first assignment from a change in the subject", async () => {
    expect((await renderDriverAssignment(input)).subject).toBe(
      "Van reservation VR-1042 — van assignment set",
    );
    expect(
      (await renderDriverAssignment({ ...input, change: "changed" })).subject,
    ).toBe("Van reservation VR-1042 — van assignment changed");
  });

  /**
   * Van and driver are assigned INDEPENDENTLY, so this one notice fires when
   * either moves. Copy naming the driver would tell a requestor whose driver did
   * not change that it did — pinned here so it cannot regress.
   */
  it("speaks of the assignment, never of the driver alone", async () => {
    for (const change of ["assigned", "changed"] as const) {
      const { html, text } = await renderDriverAssignment({ ...input, change });
      expect(html).toContain(
        change === "changed" ? "Van assignment changed" : "Van assignment set",
      );
      // The lead, in the plain-text alternative where markup cannot hide it.
      expect(text).not.toContain("the driver for your van reservation");
      expect(text).not.toContain("a driver has been assigned");
    }
  });

  it("shows the driver, mobile, and plate for the trip", async () => {
    const { html } = await renderDriverAssignment(input);
    expect(html).toContain("Rico Santos");
    expect(html).toContain("0917 555 0100");
    expect(html).toContain("ABC 1234");
  });

  it("carries a driver per trip, since each can differ", async () => {
    const { html } = await renderDriverAssignment({
      ...input,
      trips: [
        trip,
        {
          ...trip,
          referenceId: "VR-1043",
          driver: {
            name: "Ana Villa",
            mobile: "0917 555 0200",
            plate: "XYZ 9876",
          },
        },
      ],
    });
    expect(html).toContain("Rico Santos");
    expect(html).toContain("Ana Villa");
    expect(html).toContain("XYZ 9876");
  });

  it("says the status is unchanged, because an assignment is not a decision", async () => {
    const { text } = await renderDriverAssignment({
      ...input,
      change: "changed",
    });
    expect(text).toContain("still approved");
  });

  it("tells the requestor to ring the driver when there is a number", async () => {
    const { text } = await renderDriverAssignment(input);
    expect(text).toContain("Contact the driver directly on the number above");
  });

  /**
   * A van assigned before any driver: `loadRequestInformation` dashes the driver
   * half rather than dropping the block, because the payload's strings are
   * `min(1)`. `write.int.test.ts`'s "records the first van assignment on a save
   * that decides nothing" queues exactly this mail.
   */
  it("does not tell the requestor to ring a driver who has none", async () => {
    const { html, text } = await renderDriverAssignment({
      ...input,
      trips: [
        {
          ...trip,
          driver: { name: EM_DASH, mobile: EM_DASH, plate: "ABC 1234" },
        },
      ],
    });
    expect(text).not.toContain("Contact the driver");
    // The rest of the mail is unaffected: the van they are meeting is still on it.
    expect(html).toContain("ABC 1234");
    expect(text).toContain("See the full details at");
  });

  it("drops the per-trip driver line when any trip has no number", async () => {
    const { text } = await renderDriverAssignment({
      ...input,
      trips: [
        trip,
        {
          ...trip,
          referenceId: "VR-1043",
          driver: { name: EM_DASH, mobile: EM_DASH, plate: "XYZ 9876" },
        },
      ],
    });
    // The sentence claims every card names a driver; one dashed trip makes that
    // false, so it is omitted rather than half-true.
    expect(text).not.toContain("Each trip above shows its own driver");
  });

  it("renders a plain-text alternative without markup", async () => {
    const { text } = await renderDriverAssignment(input);
    expect(text).toContain("Rico Santos");
    expect(text).not.toContain("<html");
  });
});
