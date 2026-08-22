import type { Transaction } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { EM_DASH, instantFromManila } from "@/lib/tz";
import type { DB } from "@/modules/db/types";
import {
  loadRequestInformation,
  recordNotification,
} from "@/modules/reservations/notify";
import { testDb, withRollback } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function seedUser(trx: Transaction<DB>): Promise<string> {
  const row = await trx
    .insertInto("users")
    .values({
      domain_id: "ZZ60001",
      name: "Juan Cruz",
      email: "juan.cruz@notify.invalid",
      role: "associate",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const base = {
  reservationId: null,
  event: "approved" as const,
  title: "Van reservation approved",
  body: "VR-1042 is approved.",
  link: "/manage?ref=VR-1042",
};

describe("recordNotification", () => {
  it("writes one event row describing what happened", async () => {
    await withRollback(db, async (trx) => {
      const id = await recordNotification(trx, base);

      const event = await trx
        .selectFrom("notification_events")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();

      expect(event.event).toBe("approved");
      expect(event.title).toBe("Van reservation approved");
      expect(event.link).toBe("/manage?ref=VR-1042");
      expect(event.read_at).toBeNull();
      expect(event.recipient_user_id).toBeNull();
    });
  });

  it("targets an in-app recipient when the event has one", async () => {
    await withRollback(db, async (trx) => {
      const userId = await seedUser(trx);
      const id = await recordNotification(trx, {
        ...base,
        recipientUserId: userId,
      });

      const event = await trx
        .selectFrom("notification_events")
        .select("recipient_user_id")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(event.recipient_user_id).toBe(userId);
    });
  });

  it("queues one email per channel entry, all against the same event", async () => {
    await withRollback(db, async (trx) => {
      const id = await recordNotification(trx, {
        ...base,
        emails: [
          {
            template: "booking-status-change",
            recipient: "juan@example.invalid",
            cc: ["ivy@example.invalid"],
            payload: { status: "Approved" },
          },
          {
            template: "admin-new-request",
            recipient: "ivy@example.invalid, ruwi@example.invalid",
            payload: { site: "Iloilo" },
          },
        ],
      });

      const queued = await trx
        .selectFrom("notification_outbox")
        .selectAll()
        .orderBy("template")
        .execute();

      expect(queued).toHaveLength(2);
      expect(queued.every((row) => row.event_id === id)).toBe(true);
      expect(queued[0].template).toBe("admin-new-request");
      // Absent cc becomes an empty array, never a null.
      expect(queued[0].cc).toEqual([]);
      expect(queued[1].cc).toEqual(["ivy@example.invalid"]);
      expect(queued[1].payload).toEqual({ status: "Approved" });
    });
  });

  it("skips a blank-recipient email but still records the event", async () => {
    await withRollback(db, async (trx) => {
      // Happens when a site has no notifiable admin. Queueing it would
      // manufacture a permanent VALIDATION_FAILED and train whoever reads the
      // failure log to ignore it — but the event itself still happened.
      const id = await recordNotification(trx, {
        ...base,
        emails: [
          {
            template: "admin-new-request",
            recipient: "   ",
            payload: {},
          },
        ],
      });

      expect(
        await trx.selectFrom("notification_outbox").selectAll().execute(),
      ).toHaveLength(0);
      expect(
        await trx
          .selectFrom("notification_events")
          .selectAll()
          .where("id", "=", id)
          .execute(),
      ).toHaveLength(1);
    });
  });

  it("records an in-app-only event, with no email at all", async () => {
    await withRollback(db, async (trx) => {
      const userId = await seedUser(trx);
      await recordNotification(trx, { ...base, recipientUserId: userId });
      expect(
        await trx.selectFrom("notification_outbox").selectAll().execute(),
      ).toHaveLength(0);
    });
  });
});

/** A committed reservation plus its passengers, for the row-based builder. */
async function seedReservation(
  trx: Transaction<DB>,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const userId = await seedUser(trx);
  const reservation = await trx
    .insertInto("reservations")
    .values({
      reference_no: "VR-9001",
      ride_mode: "pickup",
      status: "pending",
      site: "iloilo",
      requestor_user_id: userId,
      requestor_name: "Juan Cruz",
      requestor_email: "juan.cruz@notify.invalid",
      requestor_mobile: "09171234567",
      purpose: "Client visit",
      details: "Notify test trip.",
      start_at: instantFromManila("2026-08-10", "07:30") as Date,
      pickup_location: "Smallville",
      dropoff_location: "CGS Office",
      ...overrides,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await trx
    .insertInto("reservation_passengers")
    .values([
      {
        reservation_id: reservation.id,
        domain_id: "AB12345",
        name: "Juan Cruz",
        position: 1,
      },
      {
        reservation_id: reservation.id,
        domain_id: "AC67890",
        name: "Maria Reyes",
        position: 0,
      },
    ])
    .execute();

  return reservation.id;
}

describe("loadRequestInformation", () => {
  it("rebuilds the card for a stored pickup reservation", async () => {
    await withRollback(db, async (trx) => {
      const input = await loadRequestInformation(
        trx,
        await seedReservation(trx),
      );

      expect(input.site).toBe("Iloilo");
      expect(input.rideMode).toBe("Pickup / Drop-Off");
      expect(input.requestor).toEqual({
        name: "Juan Cruz",
        email: "juan.cruz@notify.invalid",
        mobile: "09171234567",
      });

      // One reservation is one trip, so there is exactly one card.
      expect(input.trips).toHaveLength(1);
      const trip = input.trips[0];
      if (trip.mode !== "pickup") throw new Error("expected a pickup trip");
      expect(trip.referenceId).toBe("VR-9001");
      // start_at is a timestamptz: converted to Manila BEFORE formatting, or a
      // 7:30 AM booking reads as the previous day west of Manila.
      expect(trip.pickup).toBe("Aug 10 2026 · 7:30 AM");
      expect(trip.dropoffPoint).toBe("CGS Office");
    });
  });

  it("orders passengers by position, as the requestor entered them", async () => {
    await withRollback(db, async (trx) => {
      const input = await loadRequestInformation(
        trx,
        await seedReservation(trx),
      );
      expect(input.trips[0].passengers).toEqual([
        { name: "Maria Reyes", domainId: "AC67890" },
        { name: "Juan Cruz", domainId: "AB12345" },
      ]);
    });
  });

  it("rebuilds a standby reservation as a window and reporting point", async () => {
    await withRollback(db, async (trx) => {
      const id = await seedReservation(trx, {
        reference_no: "VR-9002",
        ride_mode: "standby",
        site: "manila",
        approving_tower_head: "Ramon Diaz",
        start_at: instantFromManila("2026-08-17", "06:00") as Date,
        end_at: instantFromManila("2026-08-19", "18:00") as Date,
        pickup_location: "CGS Tower lobby",
        dropoff_location: null,
      });

      const input = await loadRequestInformation(trx, id);
      expect(input.site).toBe("Manila");
      expect(input.rideMode).toBe("Standby Van");

      const trip = input.trips[0];
      if (trip.mode !== "standby") throw new Error("expected a standby trip");
      expect(trip.towerHead).toBe("Ramon Diaz");
      expect(trip.window).toBe("Aug 17 2026 → Aug 19 2026");
      expect(trip.hours).toBe("6:00 AM – 6:00 PM");
      expect(trip.reportingPoint).toBe("CGS Tower lobby");
    });
  });

  it("cannot meet a pickup without a drop-off — the schema forbids it", async () => {
    await withRollback(db, async (trx) => {
      // `reservations_mode_shape_check` requires dropoff_location on a pickup row
      // (and forbids it on a standby one). So the `?? EM_DASH` fallback in the
      // pickup branch is a TYPE-level concession to the nullable column, not a
      // display case anyone can reach. This test is what says so.
      await expect(
        seedReservation(trx, {
          reference_no: "VR-9003",
          dropoff_location: null,
        }),
      ).rejects.toThrow(/reservations_mode_shape_check/);
    });
  });

  /**
   * The "Assigned van" block. Nothing populated it before the van/driver split
   * landed, so the `driver-assignment` mail — whose whole purpose is conveying
   * these three fields — rendered none of them.
   */
  describe("the assigned van block", () => {
    it("omits it entirely while neither side is assigned", async () => {
      await withRollback(db, async (trx) => {
        const input = await loadRequestInformation(
          trx,
          await seedReservation(trx),
        );
        expect(input.trips[0].driver).toBeUndefined();
      });
    });

    it("builds it from the roster rows", async () => {
      await withRollback(db, async (trx) => {
        const driver = await trx
          .insertInto("drivers")
          .values({
            name: "Villanueva, Ruel",
            mobile: "09170000001",
            site: "iloilo",
            shift: null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const van = await trx
          .insertInto("vans")
          .values({
            van_number: "VAN-07",
            plate: "NOT 0007",
            car_type: "Toyota Hiace",
            site: "iloilo",
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        const input = await loadRequestInformation(
          trx,
          await seedReservation(trx, {
            assigned_driver_id: driver.id,
            assigned_van_id: van.id,
          }),
        );
        expect(input.trips[0].driver).toEqual({
          name: "Villanueva, Ruel",
          mobile: "09170000001",
          plate: "NOT 0007",
          carType: "Toyota Hiace",
        });
      });
    });

    it("builds it from the rental fields, without disclosing the rental", async () => {
      await withRollback(db, async (trx) => {
        const input = await loadRequestInformation(
          trx,
          await seedReservation(trx, {
            rental_driver_name: "Rental Ramos",
            rental_driver_mobile: "09171234567",
            rental_van_number: null,
            rental_plate: "RENT 0001",
            rental_car_type: "GL Grandia",
          }),
        );
        // The same three fields, and nothing saying who owns the van: the
        // requestor needs to meet it, not to know it was hired.
        expect(input.trips[0].driver).toEqual({
          name: "Rental Ramos",
          mobile: "09171234567",
          plate: "RENT 0001",
          carType: "GL Grandia",
        });
      });
    });

    it("dashes the half that is missing rather than dropping the block", async () => {
      await withRollback(db, async (trx) => {
        const van = await trx
          .insertInto("vans")
          .values({
            van_number: "VAN-08",
            plate: "NOT 0008",
            car_type: "Toyota Hiace",
            site: "iloilo",
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        const input = await loadRequestInformation(
          trx,
          await seedReservation(trx, { assigned_van_id: van.id }),
        );
        // A blank string would fail the template payload's `min(1)` and burn
        // the outbox row; a dash renders.
        expect(input.trips[0].driver).toEqual({
          name: EM_DASH,
          mobile: EM_DASH,
          plate: "NOT 0008",
          carType: "Toyota Hiace",
        });
      });
    });
  });
});
