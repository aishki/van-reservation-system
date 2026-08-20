import { describe, expect, it } from "vitest";
import {
  type BookingSubmittedInput,
  renderBookingSubmitted,
} from "@/modules/email/templates/booking-submitted";
import type { RequestTrip } from "@/modules/email/templates/request-information";

const trip = (overrides: Partial<RequestTrip> = {}): RequestTrip =>
  ({
    mode: "pickup",
    referenceId: "VR-1042",
    purpose: "Client visit",
    pickup: "Mon, 10 Aug 2026, 7:30 AM",
    pickupPoint: "Smallville",
    dropoffPoint: "CGS Office",
    passengers: [{ name: "Juan Cruz", domainId: "AB12345" }],
    ...overrides,
  }) as RequestTrip;

const input = (...trips: RequestTrip[]): BookingSubmittedInput => ({
  site: "Iloilo",
  rideMode: "Pickup / Drop-off",
  requestor: {
    name: "Juan Cruz",
    email: "juan.cruz@example.invalid",
    mobile: "0917 123 4567",
  },
  manageUrl: "http://localhost:3000/manage",
  trips,
});

const three = input(
  trip(),
  trip({ referenceId: "VR-1043", purpose: "Site inspection" }),
  trip({ referenceId: "VR-1044", purpose: "Airport run" }),
);

describe("renderBookingSubmitted", () => {
  it("names the single reference in the subject when one trip was sent", async () => {
    const { subject } = await renderBookingSubmitted(input(trip()));
    expect(subject).toBe("Van booking VR-1042 received — Pending approval");
  });

  it("counts the trips in the subject instead of listing every reference", async () => {
    const { subject } = await renderBookingSubmitted(three);
    expect(subject).toBe(
      "Van booking request received — 3 trips, Pending approval",
    );
  });

  it("emphasises the pending status and what happens next", async () => {
    const { html, text } = await renderBookingSubmitted(three);
    expect(html).toContain("Pending");
    // The requestor's next question is "so what now?" — the mail must answer it.
    expect(text).toContain("assign a driver");
  });

  it("carries the full request information for every trip", async () => {
    const { html } = await renderBookingSubmitted(three);
    for (const value of [
      "Iloilo",
      "Pickup / Drop-off",
      "Juan Cruz",
      "0917 123 4567",
      "VR-1042",
      "VR-1043",
      "VR-1044",
      "Airport run",
      "Juan Cruz (AB12345)",
      "http://localhost:3000/manage",
    ]) {
      expect(html).toContain(value);
    }
  });

  it("renders a plain-text alternative with every reference but no markup", async () => {
    const { text } = await renderBookingSubmitted(three);
    for (const reference of ["VR-1042", "VR-1043", "VR-1044"]) {
      expect(text).toContain(reference);
    }
    expect(text).not.toContain("<html");
    expect(text).not.toContain("<p>");
  });
});
