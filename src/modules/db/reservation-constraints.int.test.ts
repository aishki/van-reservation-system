import { sql } from "kysely";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  // beforeEach cleans up before every test but nothing runs after the LAST
  // test in this file — without this, this suite's rows (VR-2026-900xxx, the
  // ZZ90010 user, the "Driver, Test" driver) leak into whichever int test
  // file happens to run next under fileParallelism: false. Same shape as the
  // f9bc136/3925150/038f891 leak fixes — deleted in FK-safe order, scoped the
  // same way beforeEach is.
  await sql`delete from reservation_events`.execute(db);
  await sql`delete from reservation_passengers`.execute(db);
  await sql`delete from reservations`.execute(db);
  await sql`delete from drivers`.execute(db);
  await sql`delete from vans`.execute(db);
  await sql`delete from users where domain_id = 'ZZ90010'`.execute(db);
  await db.destroy();
});

let userId: string;
let driverId: string;
let vanId: string;

beforeEach(async () => {
  await sql`delete from reservation_events`.execute(db);
  await sql`delete from reservation_passengers`.execute(db);
  await sql`delete from reservations`.execute(db);
  await sql`delete from drivers`.execute(db);
  await sql`delete from vans`.execute(db);
  await sql`delete from users where domain_id = 'ZZ90010'`.execute(db);

  const user = await db
    .insertInto("users")
    .values({
      domain_id: "ZZ90010",
      name: "Constraint Tester",
      email: "constraints@example.invalid",
      role: "associate",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  userId = user.id;

  const driver = await db
    .insertInto("drivers")
    .values({
      name: "Driver, Test",
      mobile: "09170000000",
      site: "manila",
      shift: "11AM-11PM",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  driverId = driver.id;

  const van = await db
    .insertInto("vans")
    .values({
      van_number: "VAN-99",
      plate: "TST 0002",
      car_type: "Toyota Hiace",
      site: "manila",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  vanId = van.id;
});

/** A minimal valid pickup row; tests override one field at a time. */
function pickupRow(reference: string) {
  return {
    reference_no: reference,
    ride_mode: "pickup",
    status: "pending",
    site: "manila",
    requestor_user_id: userId,
    requestor_name: "Tester, Constraint",
    requestor_email: "constraints@example.invalid",
    requestor_mobile: "09171112222",
    purpose: "Travel-Related (Airport Transfers)",
    details: "Constraint test pickup trip.",
    start_at: new Date("2026-08-10T22:30:00Z"),
    pickup_location: "GLS Tower lobby",
    dropoff_location: "AGT Building",
  };
}

/** A minimal valid standby row. */
function standbyRow(reference: string) {
  return {
    reference_no: reference,
    ride_mode: "standby",
    status: "pending",
    site: "iloilo",
    requestor_user_id: userId,
    requestor_name: "Tester, Constraint",
    requestor_email: "constraints@example.invalid",
    requestor_mobile: "09171112222",
    purpose: "Others",
    details: "Constraint test standby trip.",
    start_at: new Date("2026-08-10T23:00:00Z"),
    end_at: new Date("2026-08-11T09:00:00Z"),
    pickup_location: "AGT Tower lobby",
    approving_tower_head: "Abanto, Norlyn",
  };
}

/**
 * `values` is deliberately an open record so callers can pass any shape a
 * CHECK constraint must reject. The cast is what bridges that open record to
 * Kysely's insert signature, and that is its ONLY job — the rows themselves
 * are all type-valid, since the generated types leave every enum column a
 * plain `string`. Do not read this cast as licence to cast a row literal:
 * elsewhere in this file such casts worked around nothing and were removed.
 */
async function expectRejected(values: Record<string, unknown>) {
  await expect(
    db
      .insertInto("reservations")
      .values(values as never)
      .execute(),
  ).rejects.toThrow();
}

describe("reservations CHECK constraints", () => {
  it("accepts a valid pickup and a valid standby row", async () => {
    await db
      .insertInto("reservations")
      .values(pickupRow("VR-2026-900001"))
      .execute();
    await db
      .insertInto("reservations")
      .values(standbyRow("VR-2026-900002"))
      .execute();
  });

  it("rejects approved without an assigned driver", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900003"),
      status: "approved",
    });
  });

  it("accepts approved WITH an assigned driver", async () => {
    await db
      .insertInto("reservations")
      .values({
        ...pickupRow("VR-2026-900004"),
        status: "approved",
        assigned_driver_id: driverId,
        assigned_van_id: vanId,
      })
      .execute();
  });

  it("rejects rejected without a reason", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900005"),
      status: "rejected",
    });
  });

  it("rejects cancelled without reason and role", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900006"),
      status: "cancelled",
    });
    await expectRejected({
      ...pickupRow("VR-2026-900007"),
      status: "cancelled",
      cancellation_reason: "No longer needed.",
      // cancelled_by_role missing — reason and role must travel together
    });
  });

  it("rejects a cancellation role without a reason", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900008"),
      cancelled_by_role: "associate",
    });
  });

  it("rejects end_at at or before start_at", async () => {
    await expectRejected({
      ...standbyRow("VR-2026-900009"),
      end_at: new Date("2026-08-10T23:00:00Z"),
    });
  });

  it("rejects a pickup with standby-only fields or without a dropoff", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900010"),
      dropoff_location: null,
    });
    await expectRejected({
      ...pickupRow("VR-2026-900011"),
      approving_tower_head: "Abanto, Norlyn",
    });
    await expectRejected({ ...pickupRow("VR-2026-900012"), cost_php: 5000 });
    await expectRejected({
      ...pickupRow("VR-2026-900013"),
      end_at: new Date("2026-08-11T09:00:00Z"),
    });
  });

  it("rejects a standby without end_at or tower head, or with a dropoff", async () => {
    await expectRejected({ ...standbyRow("VR-2026-900014"), end_at: null });
    await expectRejected({
      ...standbyRow("VR-2026-900015"),
      approving_tower_head: null,
    });
    await expectRejected({
      ...standbyRow("VR-2026-900016"),
      dropoff_location: "AGT Building",
    });
  });

  it("rejects a negative cost", async () => {
    await expectRejected({ ...standbyRow("VR-2026-900017"), cost_php: -1 });
  });

  it("rejects a duplicate reference_no", async () => {
    await db
      .insertInto("reservations")
      .values(pickupRow("VR-2026-900018"))
      .execute();
    await expectRejected(pickupRow("VR-2026-900018"));
  });

  it("rejects a blank details value", async () => {
    await expectRejected({ ...pickupRow("VR-2026-900030"), details: "" });
  });

  // btrim, not <> '': three spaces satisfy the naive check and reach an
  // admin as blank context — the same trap `validateDecision` trims for.
  it("rejects a whitespace-only details value", async () => {
    await expectRejected({ ...pickupRow("VR-2026-900031"), details: "   " });
  });
});

describe("reservation_passengers", () => {
  it("cascades on reservation delete and enforces unique position", async () => {
    const r = await db
      .insertInto("reservations")
      .values(pickupRow("VR-2026-900019"))
      .returning("id")
      .executeTakeFirstOrThrow();

    await db
      .insertInto("reservation_passengers")
      .values({
        reservation_id: r.id,
        domain_id: "AJ29104",
        name: "Jimera, Arielle",
        position: 1,
      })
      .execute();

    await expect(
      db
        .insertInto("reservation_passengers")
        .values({
          reservation_id: r.id,
          domain_id: "AM10394",
          name: "Dizon, Marco",
          position: 1,
        })
        .execute(),
    ).rejects.toThrow();

    await db.deleteFrom("reservations").where("id", "=", r.id).execute();
    const orphans = await db
      .selectFrom("reservation_passengers")
      .select("id")
      .where("reservation_id", "=", r.id)
      .execute();
    expect(orphans).toHaveLength(0);
  });
});

describe("reservation_events actor coherence", () => {
  it("accepts an all-null system actor and a full human actor, rejects a half actor", async () => {
    const r = await db
      .insertInto("reservations")
      .values(pickupRow("VR-2026-900020"))
      .returning("id")
      .executeTakeFirstOrThrow();

    await db
      .insertInto("reservation_events")
      .values({ reservation_id: r.id, event_type: "submitted" })
      .execute();

    await db
      .insertInto("reservation_events")
      .values({
        reservation_id: r.id,
        actor_user_id: userId,
        actor_name: "Tester, Constraint",
        actor_role: "associate",
        event_type: "modified",
      })
      .execute();

    await expect(
      db
        .insertInto("reservation_events")
        .values({
          reservation_id: r.id,
          actor_user_id: userId,
          event_type: "modified",
        })
        .execute(),
    ).rejects.toThrow();
  });
});

describe("driver and van assignment constraints", () => {
  it("rejects a roster driver and a rental driver together", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900021"),
      assigned_driver_id: driverId,
      rental_driver_name: "Rental Ramos",
      rental_driver_mobile: "9171234567",
    });
  });

  it("rejects a roster van and a rental van together", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900022"),
      assigned_van_id: vanId,
      rental_plate: "RENT 0001",
      rental_car_type: "Toyota GL",
    });
  });

  it("rejects approval with a driver but no van", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900023"),
      status: "approved",
      assigned_driver_id: driverId,
    });
  });

  it("rejects approval with a van but no driver", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900024"),
      status: "approved",
      assigned_van_id: vanId,
    });
  });

  it("accepts approval with a rental driver and a rental van", async () => {
    const row = await db
      .insertInto("reservations")
      .values({
        ...pickupRow("VR-2026-900025"),
        status: "approved",
        rental_driver_name: "Rental Ramos",
        rental_driver_mobile: "9171234567",
        rental_plate: "RENT 0002",
        rental_car_type: "Hi Ace Super Grandia",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(row.id).toBeTruthy();
  });

  it("rejects a rental driver without a mobile", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900026"),
      rental_driver_name: "Ramos",
    });
  });

  it("rejects a rental mobile without a name", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900027"),
      rental_driver_mobile: "9171234567",
    });
  });

  it("rejects a rental plate without a car type", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900028"),
      rental_plate: "RENT 0003",
    });
  });

  it("rejects a rental van number with no rental plate", async () => {
    await expectRejected({
      ...pickupRow("VR-2026-900029"),
      rental_van_number: "RENT-01",
    });
  });
});

describe("reservations_status_check admits the reassigned status", () => {
  it("accepts an approved_reassigned row that names a driver and a van", async () => {
    const row = await db
      .insertInto("reservations")
      .values({
        ...pickupRow("VR-2026-900040"),
        status: "approved_reassigned",
        assigned_driver_id: driverId,
        assigned_van_id: vanId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(row.id).toBeTruthy();
  });

  // The approval guards named 'approved' LITERALLY. Left un-widened, a row at
  // the new status escapes both of them and a reassigned trip with nobody
  // driving it becomes schema-legal — the exact condition these constraints
  // exist to prevent. Matching on the constraint NAME is what distinguishes a
  // widened guard from a status the schema simply refuses.
  it("refuses an approved_reassigned row with no driver", async () => {
    await expect(
      db
        .insertInto("reservations")
        .values({
          ...pickupRow("VR-2026-900041"),
          status: "approved_reassigned",
          assigned_van_id: vanId,
        })
        .execute(),
    ).rejects.toThrow(/reservations_approved_driver_check/);
  });

  it("refuses an approved_reassigned row with no van", async () => {
    await expect(
      db
        .insertInto("reservations")
        .values({
          ...pickupRow("VR-2026-900042"),
          status: "approved_reassigned",
          assigned_driver_id: driverId,
        })
        .execute(),
    ).rejects.toThrow(/reservations_approved_van_check/);
  });
});
