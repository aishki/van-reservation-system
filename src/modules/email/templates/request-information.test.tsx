import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import {
  RequestInformation,
  type RequestInformationInput,
  type RequestTrip,
} from "@/modules/email/templates/request-information";

const pickupTrip: RequestTrip = {
  mode: "pickup",
  referenceId: "VR-1042",
  purpose: "Client visit",
  details: "Quarterly review with the account team.",
  pickup: "Mon, 10 Aug 2026, 7:30 AM",
  pickupPoint: "Smallville",
  dropoffPoint: "CGS Office",
  passengers: [
    { name: "Juan Cruz", domainId: "AB12345" },
    { name: "Maria Reyes", domainId: "AC67890" },
  ],
};

const base: RequestInformationInput = {
  site: "Iloilo",
  rideMode: "Pickup / Drop-off",
  requestor: {
    name: "Juan Cruz",
    email: "juan.cruz@example.invalid",
    mobile: "0917 123 4567",
  },
  trips: [pickupTrip],
};

const html = (input: RequestInformationInput) =>
  render(<RequestInformation {...input} />);

describe("RequestInformation", () => {
  it("opens with the site and ride type", async () => {
    const out = await html(base);
    expect(out).toContain("Iloilo");
    expect(out).toContain("Pickup / Drop-off");
  });

  it("carries the requestor's contact details", async () => {
    const out = await html(base);
    expect(out).toContain("Juan Cruz");
    expect(out).toContain("juan.cruz@example.invalid");
    expect(out).toContain("0917 123 4567");
  });

  it("shows the trip's details under its purpose", async () => {
    const out = await html(base);
    expect(out).toContain("Details");
    expect(out).toContain("Quarterly review with the account team.");
    expect(out.indexOf("Purpose")).toBeLessThan(out.indexOf("Details"));
  });

  it("gives each trip its own numbered card with its reference", async () => {
    const out = await html({
      ...base,
      trips: [
        pickupTrip,
        { ...pickupTrip, referenceId: "VR-1043", purpose: "Site inspection" },
      ],
    });
    expect(out).toContain("Trip 1");
    expect(out).toContain("Trip 2");
    expect(out).toContain("VR-1042");
    expect(out).toContain("VR-1043");
    expect(out).toContain("Site inspection");
  });

  it("lists the passengers with their domain ids and a count", async () => {
    const out = await html(base);
    expect(out).toContain("2 passengers");
    expect(out).toContain("Juan Cruz (AB12345)");
    expect(out).toContain("Maria Reyes (AC67890)");
  });

  it("says 1 passenger, not 1 passengers", async () => {
    const out = await html({
      ...base,
      trips: [{ ...pickupTrip, passengers: [pickupTrip.passengers[0]] }],
    });
    expect(out).toContain("1 passenger:");
    expect(out).not.toContain("1 passengers");
  });

  it("labels standby cards as dates and shows the window, not a pickup", async () => {
    const out = await html({
      ...base,
      rideMode: "Standby",
      trips: [
        {
          mode: "standby",
          referenceId: "VR-1045",
          purpose: "Audit week",
          details: "Vehicle held on call for the audit team.",
          towerHead: "Ramon Diaz",
          window: "Mon, 17 Aug 2026 → Wed, 19 Aug 2026",
          hours: "6:00 AM – 6:00 PM",
          reportingPoint: "CGS Tower lobby",
          passengers: [{ name: "Juan Cruz", domainId: "AB12345" }],
        },
      ],
    });
    expect(out).toContain("Date 1");
    expect(out).not.toContain("Trip 1");
    expect(out).toContain("Ramon Diaz");
    expect(out).toContain("6:00 AM – 6:00 PM");
    expect(out).toContain("Reporting Point");
    expect(out).not.toContain("Drop-off Point");
    // Reporting Point precedes Hours, per the standby card's field order.
    expect(out.indexOf("Reporting Point")).toBeLessThan(out.indexOf("Hours"));
  });
});

describe("RequestInformation driver details", () => {
  const withDriver: RequestTrip = {
    ...pickupTrip,
    driver: { name: "Rico Santos", mobile: "0917 555 0100", plate: "ABC 1234" },
  };

  it("shows the assigned van inside the trip card", async () => {
    const out = await html({ ...base, trips: [withDriver] });
    expect(out).toContain("Assigned van");
    expect(out).toContain("Rico Santos");
    expect(out).toContain("0917 555 0100");
    expect(out).toContain("ABC 1234");
  });

  it("says nothing about a driver when none is assigned", async () => {
    const out = await html(base);
    expect(out).not.toContain("Assigned van");
  });

  it("lets each trip carry its own driver and plate", async () => {
    // A driver may take a different unit on a different day, so the plate
    // belongs to the assignment rather than to the person.
    const out = await html({
      ...base,
      trips: [
        withDriver,
        {
          ...withDriver,
          referenceId: "VR-1043",
          driver: {
            name: "Rico Santos",
            mobile: "0917 555 0100",
            plate: "XYZ 9876",
          },
        },
      ],
    });
    expect(out).toContain("ABC 1234");
    expect(out).toContain("XYZ 9876");
  });

  // A plate alone does not tell a requestor whether to expect a sedan or a
  // Hi Ace — naming the vehicle does.
  it("shows the car type when the payload carries one", async () => {
    const out = await html({
      ...base,
      trips: [
        {
          ...pickupTrip,
          driver: {
            name: "Rico Santos",
            mobile: "0917 555 0100",
            plate: "ABC 1234",
            carType: "Hi Ace Super Grandia",
          },
        },
      ],
    });
    expect(out).toContain("Hi Ace Super Grandia");
  });

  it("renders the assigned van block without a car type row when absent", async () => {
    // A pre-deploy outbox row's payload has no carType at all.
    const out = await html({ ...base, trips: [withDriver] });
    expect(out).toContain("Assigned van");
    expect(out).not.toContain("undefined");
  });
});
