import { describe, expect, it } from "vitest";
import {
  type AdminNewRequestInput,
  renderAdminNewRequest,
} from "@/modules/email/templates/admin-new-request";
import type { RequestTrip } from "@/modules/email/templates/request-information";

const trip: RequestTrip = {
  mode: "pickup",
  referenceId: "VR-1042",
  purpose: "Client visit",
  details: "Quarterly review with the account team.",
  pickup: "Mon, 10 Aug 2026, 7:30 AM",
  pickupPoint: "Smallville",
  dropoffPoint: "CGS Office",
  passengers: [{ name: "Juan Cruz", domainId: "AB12345" }],
};

const input: AdminNewRequestInput = {
  site: "Iloilo",
  rideMode: "Pickup / Drop-off",
  requestor: {
    name: "Juan Cruz",
    email: "juan.cruz@example.invalid",
    mobile: "0917 123 4567",
  },
  adminUrl: "http://localhost:3000/dashboard",
  trips: [trip, { ...trip, referenceId: "VR-1043", purpose: "Airport run" }],
};

describe("renderAdminNewRequest", () => {
  it("names the requestor and the site in the subject", async () => {
    const { subject } = await renderAdminNewRequest(input);
    expect(subject).toBe("New van reservation — Juan Cruz (Iloilo), 2 trips");
  });

  it("drops the trip count from the subject for a single trip", async () => {
    const { subject } = await renderAdminNewRequest({
      ...input,
      trips: [trip],
    });
    expect(subject).toBe("New van reservation — Juan Cruz (Iloilo)");
  });

  it("says who submitted it and asks the admin to assign a driver", async () => {
    const { text } = await renderAdminNewRequest(input);
    expect(text).toContain("submitted by Juan Cruz");
    expect(text).toContain("assign a driver");
    expect(text).toContain("http://localhost:3000/dashboard");
  });

  it("carries the full request information for every trip", async () => {
    const { html } = await renderAdminNewRequest(input);
    for (const value of [
      "Iloilo",
      "VR-1042",
      "VR-1043",
      "Airport run",
      "0917 123 4567",
      "Juan Cruz (AB12345)",
    ]) {
      expect(html).toContain(value);
    }
  });

  it("renders a plain-text alternative without markup", async () => {
    const { text } = await renderAdminNewRequest(input);
    expect(text).toContain("VR-1042");
    expect(text).not.toContain("<html");
  });
});
