import { describe, expect, it } from "vitest";
import {
  type BookingDraft,
  blankDraft,
  blankPassenger,
  blankTrip,
} from "@/modules/reservations/draft";
import { requestInformationFromDraft } from "@/modules/reservations/notify";

const requestor = { name: "Juan Cruz", email: "juan@example.invalid" };

function pickupDraft(): BookingDraft {
  const draft = blankDraft("pickup");
  draft.site = "Iloilo";
  draft.mobile = "0917 123 4567";
  draft.trips = [
    {
      ...blankTrip(),
      purpose: "Client visit",
      pickupDate: "2026-08-10",
      pickupTime: "07:30",
      pickupPoint: "Smallville",
      dropoffPoint: "CGS Office",
      passengers: [
        { ...blankPassenger(), domainId: "AB12345", name: "Juan Cruz" },
        { ...blankPassenger(), domainId: "AC67890", name: "Maria Reyes" },
      ],
    },
  ];
  return draft;
}

function standbyDraft(): BookingDraft {
  const draft = blankDraft("standby");
  draft.site = "Manila";
  draft.mobile = "09171234567";
  draft.trips = [
    {
      ...blankTrip(),
      purpose: "Audit week",
      towerHead: "Ramon Diaz",
      startDate: "2026-08-17",
      endDate: "2026-08-19",
      startTime: "06:00",
      endTime: "18:00",
      pickupPoint: "CGS Tower lobby",
      passengers: [
        { ...blankPassenger(), domainId: "AB12345", name: "Juan Cruz" },
      ],
    },
  ];
  return draft;
}

describe("requestInformationFromDraft", () => {
  it("maps the submission-level fields and labels the ride mode", () => {
    const input = requestInformationFromDraft(
      pickupDraft(),
      ["VR-1042"],
      requestor,
    );

    expect(input.site).toBe("Iloilo");
    expect(input.rideMode).toBe("Pickup / Drop-Off");
    expect(input.requestor).toEqual({
      name: "Juan Cruz",
      email: "juan@example.invalid",
      // Digits only — `normalizeMobile` strips separators, it does not add +63.
      mobile: "09171234567",
    });
  });

  it("pairs each trip with its own reference and formats the pickup", () => {
    const input = requestInformationFromDraft(
      pickupDraft(),
      ["VR-1042"],
      requestor,
    );

    const trip = input.trips[0];
    expect(trip.referenceId).toBe("VR-1042");
    if (trip.mode !== "pickup") throw new Error("expected a pickup trip");
    // Formatted through lib/tz, never here — an email has no timezone.
    expect(trip.pickup).toBe("Aug 10 2026 · 7:30 AM");
    expect(trip.pickupPoint).toBe("Smallville");
    expect(trip.dropoffPoint).toBe("CGS Office");
    expect(trip.passengers).toEqual([
      { name: "Juan Cruz", domainId: "AB12345" },
      { name: "Maria Reyes", domainId: "AC67890" },
    ]);
  });

  it("pairs references positionally across several trips", () => {
    const draft = pickupDraft();
    draft.trips = [
      draft.trips[0],
      { ...draft.trips[0], purpose: "Airport run" },
    ];

    const trips = requestInformationFromDraft(
      draft,
      ["VR-1042", "VR-1043"],
      requestor,
    ).trips;

    expect(trips.map((t) => t.referenceId)).toEqual(["VR-1042", "VR-1043"]);
    expect(trips[1].purpose).toBe("Airport run");
  });

  it("renders a standby draft as a window, not a pickup time", () => {
    const trip = requestInformationFromDraft(
      standbyDraft(),
      ["VR-1045"],
      requestor,
    ).trips[0];

    if (trip.mode !== "standby") throw new Error("expected a standby trip");
    expect(trip.towerHead).toBe("Ramon Diaz");
    expect(trip.window).toBe("Aug 17 2026 → Aug 19 2026");
    expect(trip.hours).toBe("6:00 AM – 6:00 PM");
    expect(trip.reportingPoint).toBe("CGS Tower lobby");
  });

  it("labels the standby ride mode from the canonical map", () => {
    expect(
      requestInformationFromDraft(standbyDraft(), ["VR-1045"], requestor)
        .rideMode,
    ).toBe("Standby Van");
  });

  it("falls back to an em dash rather than an empty field", () => {
    const draft = pickupDraft();
    draft.site = "";
    draft.trips[0].dropoffPoint = "";
    // A reference short of the trip count would otherwise render "undefined".
    const input = requestInformationFromDraft(draft, [], requestor);

    expect(input.site).toBe("—");
    const trip = input.trips[0];
    if (trip.mode !== "pickup") throw new Error("expected a pickup trip");
    expect(trip.referenceId).toBe("—");
    expect(trip.dropoffPoint).toBe("—");
  });
});
