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
  passengers: [{ name: "Juan Cruz", email: "juan.cruz@carelon.com" }],
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
const noShow: BookingStatusChangeInput = { ...common, status: "No Show" };

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
    expect((await renderBookingStatusChange(noShow)).subject).toBe(
      "Van reservation VR-1042 — No Show",
    );
  });

  it("points every status at the site for the full details", async () => {
    for (const input of [approved, rejected, cancelled, noShow]) {
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

  // A no-show is a fact to record, not something the admin explains — unlike
  // a rejection or a cancellation, there is no reason to quote.
  it("shows no reason block for a no-show either", async () => {
    const { html, text } = await renderBookingStatusChange(noShow);
    expect(html).not.toContain("Reason");
    expect(text).toContain("no-show");
  });

  it("carries the request information for every status", async () => {
    for (const input of [approved, rejected, cancelled, noShow]) {
      const { html } = await renderBookingStatusChange(input);
      for (const value of [
        "VR-1042",
        "Iloilo",
        "Juan Cruz (juan.cruz@carelon.com)",
      ]) {
        expect(html).toContain(value);
      }
    }
  });

  it("renders a plain-text alternative without markup", async () => {
    const { text } = await renderBookingStatusChange(approved);
    expect(text).not.toContain("<html");
    expect(text).not.toContain("<p>");
  });

  describe("a passenger's copy", () => {
    const passengerCopy: BookingStatusChangeInput = {
      ...approved,
      audience: "passenger",
    };

    it("carries a Passenger Copy badge and subject suffix", async () => {
      const { html, subject } = await renderBookingStatusChange(passengerCopy);
      expect(html).toContain("Passenger Copy");
      expect(subject).toContain("Passenger Copy");
    });

    it("does not claim the admins are copied — they are not, on this copy", async () => {
      const { text } = await renderBookingStatusChange(passengerCopy);
      expect(text).not.toContain("Admin Support team is copied");
    });

    it("still names the reference and status", async () => {
      const { html } = await renderBookingStatusChange(passengerCopy);
      expect(html).toContain("VR-1042");
    });
  });
});
