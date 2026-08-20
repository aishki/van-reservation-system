import { describe, expect, it } from "vitest";
import {
  type BookingStatusChangeInput,
  renderBookingStatusChange,
} from "@/modules/email/templates/booking-status-change";
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
};

const common = {
  site: "Iloilo",
  rideMode: "Pickup / Drop-Off",
  requestor: {
    name: "Juan Cruz",
    email: "juan@example.invalid",
    mobile: "09171234567",
  },
  manageUrl: "http://localhost:3000/manage",
  trips: [trip],
};

const approved: BookingStatusChangeInput = { ...common, status: "Approved" };
const rejected: BookingStatusChangeInput = {
  ...common,
  status: "Rejected",
  rejectionReason: "No van available on that date.",
};
const cancelled: BookingStatusChangeInput = {
  ...common,
  status: "Cancelled",
  cancelledBy: "associate",
  cancellationReason: "Trip no longer needed.",
};

describe("renderBookingStatusChange", () => {
  it("names the reference and the new status in the subject", async () => {
    expect((await renderBookingStatusChange(approved)).subject).toBe(
      "Van reservation VR-1042 — Approved",
    );
    expect((await renderBookingStatusChange(rejected)).subject).toBe(
      "Van reservation VR-1042 — Rejected",
    );
    expect((await renderBookingStatusChange(cancelled)).subject).toBe(
      "Van reservation VR-1042 — Cancelled",
    );
  });

  it("points every status at the site for the full details", async () => {
    for (const input of [approved, rejected, cancelled]) {
      const { text } = await renderBookingStatusChange(input);
      expect(text).toContain("full details");
      expect(text).toContain("http://localhost:3000/manage");
    }
  });

  it("quotes the reason a request was rejected", async () => {
    const { text } = await renderBookingStatusChange(rejected);
    expect(text).toContain("No van available on that date.");
  });

  it("names who cancelled, and the reason", async () => {
    const byRequestor = await renderBookingStatusChange(cancelled);
    expect(byRequestor.text).toContain("Juan Cruz");
    expect(byRequestor.text).toContain("Trip no longer needed.");

    const byAdmin = await renderBookingStatusChange({
      ...cancelled,
      cancelledBy: "admin_support",
      cancellationReason: "Cancelled by Admin Support.",
    });
    expect(byAdmin.text).toContain("Admin Support");
  });

  it("shows no reason block for an approval, which has none", async () => {
    const { html } = await renderBookingStatusChange(approved);
    expect(html).not.toContain("Reason");
  });

  it("carries the request information for every status", async () => {
    for (const input of [approved, rejected, cancelled]) {
      const { html } = await renderBookingStatusChange(input);
      for (const value of ["VR-1042", "Iloilo", "Juan Cruz (AB12345)"]) {
        expect(html).toContain(value);
      }
    }
  });

  it("renders a plain-text alternative without markup", async () => {
    const { text } = await renderBookingStatusChange(approved);
    expect(text).not.toContain("<html");
    expect(text).not.toContain("<p>");
  });
});
