import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { affectedTrips } from "@/modules/roster/conflicts";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

/** Marks this suite's rows so cleanup cannot touch another's. */
const MARK = "conflicts-int";
const TODAY = "2026-09-01";

/** Seeded once; every trip below belongs to it. */
let userId: string;

beforeAll(async () => {
  userId = await seedUser();
});

// FK-safe order: reservations reference users, drivers and vans.
afterEach(async () => {
  await sql`delete from reservations where requestor_name = ${MARK}`.execute(
    db,
  );
  await sql`delete from drivers where name = ${MARK}`.execute(db);
  await sql`delete from vans where car_type = ${MARK}`.execute(db);
});

afterAll(async () => {
  await sql`delete from reservations where requestor_name = ${MARK}`.execute(
    db,
  );
  await sql`delete from users where name = ${MARK}`.execute(db);
});

async function seedDriver(): Promise<string> {
  const row = await db
    .insertInto("drivers")
    .values({ name: MARK, mobile: "09171234567", site: "iloilo" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function seedVan(): Promise<string> {
  const row = await db
    .insertInto("vans")
    .values({
      van_number: `VAN-${MARK}`,
      plate: `PLT-${MARK}`,
      car_type: MARK,
      site: "iloilo",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * A requestor. `reservations.requestor_user_id` is NOT NULL and references
 * `users.id`, so a trip cannot be seeded without one.
 */
async function seedUser(): Promise<string> {
  const row = await db
    .insertInto("users")
    .values({
      domain_id: "ZC90001",
      name: MARK,
      email: `${MARK}@x.invalid`,
      role: "associate",
    })
    .onConflict((oc) => oc.column("domain_id").doUpdateSet({ name: MARK }))
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * One reservation. `startAt` is an ISO instant; the caller states it so each
 * case can put a trip either side of today without arithmetic in the test.
 *
 * The column names and the null-ness here are NOT free choices —
 * `reservations_mode_shape_check` requires, for `ride_mode = 'pickup'`:
 * `dropoff_location` NOT NULL, and `end_at`, `approving_tower_head`, `vendor`
 * and `cost_php` all NULL. `reservations_time_order_check` additionally
 * requires `end_at > start_at` when it is present. A pickup trip therefore has
 * NO `end_at` at all.
 *
 * Note `pickup_location` / `dropoff_location` — the columns are not called
 * `pickup_point` / `dropoff_point`.
 */
async function seedTrip(opts: {
  reference: string;
  status: string;
  startAt: string;
  userId: string;
  driverId?: string;
  vanId?: string;
}): Promise<void> {
  // reservations_approved_driver_check / _van_check require SOME assignee —
  // fleet or rental — on each side once status is approved*. Fall back to a
  // rental record on whichever side this call did not pass a fleet id for,
  // so the seeded row stays valid without pulling in an assignment it isn't
  // testing.
  const approved =
    opts.status === "approved" || opts.status === "approved_reassigned";

  await db
    .insertInto("reservations")
    .values({
      reference_no: opts.reference,
      ride_mode: "pickup",
      status: opts.status,
      site: "iloilo",
      requestor_user_id: opts.userId,
      requestor_name: MARK,
      requestor_email: `${MARK}@x.invalid`,
      requestor_mobile: "09171234567",
      purpose: "External Affairs",
      details: "Seeded by conflicts.int.test.ts",
      start_at: new Date(opts.startAt),
      pickup_location: "Smallville",
      dropoff_location: "CGS Office",
      assigned_driver_id: opts.driverId ?? null,
      assigned_van_id: opts.vanId ?? null,
      rental_driver_name: approved && !opts.driverId ? MARK : null,
      rental_driver_mobile: approved && !opts.driverId ? "09171234567" : null,
      rental_plate: approved && !opts.vanId ? `RENTAL-${MARK}` : null,
      rental_car_type: approved && !opts.vanId ? MARK : null,
      // reservations_rejected_reason_check / _cancelled_reason_check /
      // _cancellation_pair_check require these fields whenever the status
      // demands them.
      rejection_reason:
        opts.status === "rejected" ? "Seeded by conflicts.int.test.ts" : null,
      cancellation_reason:
        opts.status === "cancelled" ? "Seeded by conflicts.int.test.ts" : null,
      cancelled_by_role: opts.status === "cancelled" ? "admin_support" : null,
    })
    .execute();
}

describe("affectedTrips", () => {
  it("finds a future approved trip for the driver", async () => {
    const driverId = await seedDriver();
    await seedTrip({
      reference: "VR-C-0001",
      status: "approved",
      startAt: "2026-09-10T02:00:00Z",
      userId,
      driverId,
    });

    const trips = await affectedTrips(db, "driver", driverId, TODAY);
    expect(trips.map((t) => t.reference)).toEqual(["VR-C-0001"]);
  });

  it("finds pending and reassigned trips, not only approved ones", async () => {
    // All three are SCHEDULED — a trip that has not happened yet will be left
    // with an inactive assignee whatever its status.
    const driverId = await seedDriver();
    await seedTrip({
      reference: "VR-C-0002",
      status: "pending",
      startAt: "2026-09-11T02:00:00Z",
      userId,
      driverId,
    });
    await seedTrip({
      reference: "VR-C-0003",
      status: "approved_reassigned",
      startAt: "2026-09-12T02:00:00Z",
      userId,
      driverId,
    });

    const trips = await affectedTrips(db, "driver", driverId, TODAY);
    expect(trips.map((t) => t.reference).sort()).toEqual([
      "VR-C-0002",
      "VR-C-0003",
    ]);
  });

  it("ignores rejected and cancelled trips", async () => {
    const driverId = await seedDriver();
    await seedTrip({
      reference: "VR-C-0004",
      status: "rejected",
      startAt: "2026-09-13T02:00:00Z",
      userId,
      driverId,
    });
    await seedTrip({
      reference: "VR-C-0005",
      status: "cancelled",
      startAt: "2026-09-14T02:00:00Z",
      userId,
      driverId,
    });

    expect(await affectedTrips(db, "driver", driverId, TODAY)).toEqual([]);
  });

  it("ignores trips in the past", async () => {
    const driverId = await seedDriver();
    await seedTrip({
      reference: "VR-C-0006",
      status: "approved",
      startAt: "2026-08-01T02:00:00Z",
      userId,
      driverId,
    });

    expect(await affectedTrips(db, "driver", driverId, TODAY)).toEqual([]);
  });

  it("includes a trip starting TODAY — it has not run yet", async () => {
    const driverId = await seedDriver();
    // 2026-09-01 16:00 Manila is 08:00Z the same day.
    await seedTrip({
      reference: "VR-C-0007",
      status: "approved",
      startAt: "2026-09-01T08:00:00Z",
      userId,
      driverId,
    });

    expect(
      (await affectedTrips(db, "driver", driverId, TODAY)).map(
        (t) => t.reference,
      ),
    ).toEqual(["VR-C-0007"]);
  });

  it("finds trips for a van independently of the driver", async () => {
    const vanId = await seedVan();
    await seedTrip({
      reference: "VR-C-0008",
      status: "approved",
      startAt: "2026-09-15T02:00:00Z",
      userId,
      vanId,
    });

    expect(
      (await affectedTrips(db, "van", vanId, TODAY)).map((t) => t.reference),
    ).toEqual(["VR-C-0008"]);
  });

  it("returns nothing for a driver with no scheduled trips", async () => {
    expect(
      await affectedTrips(db, "driver", await seedDriver(), TODAY),
    ).toEqual([]);
  });

  it("orders trips soonest first, so the nearest problem reads first", async () => {
    const driverId = await seedDriver();
    await seedTrip({
      reference: "VR-C-0010",
      status: "approved",
      startAt: "2026-09-20T02:00:00Z",
      userId,
      driverId,
    });
    await seedTrip({
      reference: "VR-C-0009",
      status: "approved",
      startAt: "2026-09-05T02:00:00Z",
      userId,
      driverId,
    });

    expect(
      (await affectedTrips(db, "driver", driverId, TODAY)).map(
        (t) => t.reference,
      ),
    ).toEqual(["VR-C-0009", "VR-C-0010"]);
  });
});
