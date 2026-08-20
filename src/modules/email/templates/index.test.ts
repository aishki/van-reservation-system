import { describe, expect, it } from "vitest";
import { EM_DASH } from "@/lib/tz";
import { renderTemplate } from "@/modules/email/templates";

const trip = {
  mode: "pickup",
  referenceId: "VR-1042",
  purpose: "Client visit",
  details: "Quarterly review with the account team.",
  pickup: "Aug 10 2026 · 7:30 AM",
  pickupPoint: "Smallville",
  dropoffPoint: "CGS Office",
  passengers: [{ name: "Juan Cruz", domainId: "AB12345" }],
};

const card = {
  site: "Iloilo",
  rideMode: "Pickup / Drop-Off",
  requestor: {
    name: "Juan Cruz",
    email: "juan@x.invalid",
    mobile: "09171234567",
  },
  trips: [trip],
};

const manage = { ...card, manageUrl: "http://localhost:3000/manage" };

describe("renderTemplate", () => {
  it("renders every registered template from a valid payload", async () => {
    const cases: [string, unknown, string][] = [
      ["booking-submitted", manage, "VR-1042"],
      [
        "admin-new-request",
        { ...card, adminUrl: "http://localhost:3000/dashboard" },
        "Juan Cruz",
      ],
      ["booking-status-change", { ...manage, status: "Approved" }, "VR-1042"],
      [
        "driver-assignment",
        {
          ...manage,
          change: "assigned",
          trips: [
            {
              ...trip,
              driver: {
                name: "Rico Santos",
                mobile: "0917 555 0100",
                plate: "ABC 1234",
              },
            },
          ],
        },
        "Rico Santos",
      ],
    ];

    for (const [name, payload, expected] of cases) {
      const result = await renderTemplate(name, payload);
      expect(result.ok, `${name} should render`).toBe(true);
      if (!result.ok) continue;
      expect(result.value.html).toContain(expected);
      expect(result.value.subject).not.toBe("");
      expect(result.value.text).not.toBe("");
    }
  });

  it("refuses an unknown template permanently", async () => {
    expect(await renderTemplate("booking-teleported", manage)).toEqual({
      ok: false,
      error: "UNKNOWN_TEMPLATE",
    });
  });

  it("refuses a payload missing a required field", async () => {
    // Caught here as a permanent failure, rather than the renderer throwing on
    // `undefined.map` half way through.
    const { trips: _dropped, ...withoutTrips } = manage;
    expect(
      await renderTemplate("booking-status-change", {
        ...withoutTrips,
        status: "Approved",
      }),
    ).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("refuses a trip whose mode is not a known one", async () => {
    expect(
      await renderTemplate("booking-status-change", {
        ...manage,
        status: "Approved",
        trips: [{ ...trip, mode: "helicopter" }],
      }),
    ).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("refuses a rejection with no reason, which the template would leave blank", async () => {
    expect(
      await renderTemplate("booking-status-change", {
        ...manage,
        status: "Rejected",
      }),
    ).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("refuses a cancellation with no canceller", async () => {
    expect(
      await renderTemplate("booking-status-change", {
        ...manage,
        status: "Cancelled",
        cancellationReason: "Not needed.",
      }),
    ).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  it("refuses an empty-string field, which sendEmail would fail as permanent", async () => {
    expect(
      await renderTemplate("booking-status-change", {
        ...manage,
        status: "Approved",
        site: "",
      }),
    ).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
  });

  // `details` became required on `reservations` after this outbox schema was
  // frozen; a row queued before that migration has no such field. Unlike
  // `site` above, that must render, not fail permanently, or a pre-deploy
  // retry can never be sent again.
  it("falls back to an em dash for a trip missing details", async () => {
    const { details: _dropped, ...tripWithoutDetails } = trip;
    const result = await renderTemplate("booking-status-change", {
      ...manage,
      status: "Approved",
      trips: [tripWithoutDetails],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.html).toContain(EM_DASH);
  });
});
