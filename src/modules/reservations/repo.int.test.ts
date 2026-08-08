import { sql } from "kysely";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getReservationDetail,
  listReservations,
} from "@/modules/reservations/repo";
import { CHANGED_TRIP_DETAILS_REMARK } from "@/modules/reservations/types";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  // beforeEach cleans up before every test but nothing runs after the LAST
  // test in this file — without this, this suite's rows (VR-2026-8000xx,
  // the ZR9000x users, the Villanueva driver) leak into whichever int test
  // file happens to run next under fileParallelism: false. Same shape as the
  // f9bc136 admin_whitelist/users leak and the reference_counters leak in
  // Task 5 — deleted in FK-safe order, scoped the same way beforeEach is.
  await sql`delete from reservation_events`.execute(db);
  await sql`delete from reservation_passengers`.execute(db);
  await sql`delete from reservations`.execute(db);
  await sql`delete from drivers`.execute(db);
  await sql`delete from vans`.execute(db);
  await sql`delete from users where domain_id in ('ZR90001', 'ZR90002', 'ZR90003')`.execute(
    db,
  );
  await db.destroy();
});

let arielleId: string;
let marcoId: string;
let adminId: string;
let driverId: string;
let vanId: string;

beforeEach(async () => {
  await sql`delete from reservation_events`.execute(db);
  await sql`delete from reservation_passengers`.execute(db);
  await sql`delete from reservations`.execute(db);
  await sql`delete from drivers`.execute(db);
  await sql`delete from vans`.execute(db);
  await sql`delete from users where domain_id in ('ZR90001', 'ZR90002', 'ZR90003')`.execute(
    db,
  );

  const insertUser = (domainId: string, name: string, role: string) =>
    db
      .insertInto("users")
      .values({
        domain_id: domainId,
        name,
        email: `${domainId.toLowerCase()}@example.invalid`,
        role,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

  arielleId = (await insertUser("ZR90001", "Jimera, Arielle", "associate")).id;
  marcoId = (await insertUser("ZR90002", "Dizon, Marco", "associate")).id;
  adminId = (await insertUser("ZR90003", "Abanto, Norlyn", "admin_support")).id;

  driverId = (
    await db
      .insertInto("drivers")
      .values({
        name: "Villanueva, Rey",
        mobile: "09171234567",
        site: "manila",
        shift: "11AM-11PM",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;

  vanId = (
    await db
      .insertInto("vans")
      .values({
        van_number: "VAN-01",
        plate: "ABC 1234",
        car_type: "Toyota Hiace",
        site: "manila",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
});

/** Inserts a pending pickup owned by `userId`, with its `submitted` event. */
async function insertPickup(
  reference: string,
  userId: string,
  submittedAt: string,
) {
  const row = await db
    .insertInto("reservations")
    .values({
      reference_no: reference,
      ride_mode: "pickup",
      status: "pending",
      site: "manila",
      requestor_user_id: userId,
      requestor_name: "Jimera, Arielle",
      requestor_email: "arielle.jimera@example.invalid",
      requestor_mobile: "09567567122",
      purpose: "Travel-Related (Airport Transfers)",
      details: "Repo test pickup trip.",
      start_at: new Date("2026-08-07T22:30:00Z"),
      pickup_location: "AGT Tower lobby",
      dropoff_location: "GLS Building",
      created_at: new Date(submittedAt),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await db
    .insertInto("reservation_events")
    .values({
      reservation_id: row.id,
      actor_user_id: userId,
      actor_name: "Jimera, Arielle",
      actor_role: "associate",
      event_type: "submitted",
      created_at: new Date(submittedAt),
    })
    .execute();

  return row.id;
}

/**
 * An approved-then-reassigned pickup. Both a driver and a van are required —
 * the widened approval guards refuse the status without them.
 */
async function insertReassigned(reference: string, userId: string) {
  await db
    .insertInto("reservations")
    .values({
      reference_no: reference,
      ride_mode: "pickup",
      status: "approved_reassigned",
      site: "manila",
      requestor_user_id: userId,
      requestor_name: "Jimera, Arielle",
      requestor_email: "arielle.jimera@example.invalid",
      requestor_mobile: "09567567122",
      purpose: "Travel-Related (Airport Transfers)",
      details: "Repo test reassigned trip.",
      start_at: new Date("2026-08-07T22:30:00Z"),
      pickup_location: "AGT Tower lobby",
      dropoff_location: "GLS Building",
      assigned_driver_id: driverId,
      assigned_van_id: vanId,
    })
    .execute();
}

/** One `reservation_events` row, with an explicit instant so ordering is real. */
async function insertEvent(
  reservationId: string,
  event: {
    event_type: string;
    actor_name: string;
    actor_role: string;
    created_at: string;
  },
) {
  await db
    .insertInto("reservation_events")
    .values({
      reservation_id: reservationId,
      actor_user_id: adminId,
      actor_name: event.actor_name,
      actor_role: event.actor_role,
      event_type: event.event_type,
      created_at: new Date(event.created_at),
    })
    .execute();
}

const findRow = async (reference: string) => {
  const rows = await listReservations(db, { all: true });
  const row = rows.find((candidate) => candidate.id === reference);
  if (row === undefined) throw new Error(`row ${reference} is missing`);
  return row;
};

describe("updatedAt and updatedBy", () => {
  it("leaves both null on a freshly submitted request", async () => {
    // `submitted` is excluded: it is the row's creation, not an update to it.
    await insertPickup("VR-2026-800100", arielleId, "2026-08-01T01:00:00Z");
    const row = await findRow("VR-2026-800100");
    expect(row.updatedAt).toBeNull();
    expect(row.updatedBy).toBeNull();
  });

  it("names the same event in both fields", async () => {
    const id = await insertPickup(
      "VR-2026-800101",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await insertEvent(id, {
      event_type: "approved",
      actor_name: "Balandra, Ivy",
      actor_role: "admin_support",
      created_at: "2026-08-02T01:00:00Z",
    });

    const row = await findRow("VR-2026-800101");
    expect(row.updatedBy).toBe("Balandra, Ivy");
    expect(row.updatedAt).toBe(new Date("2026-08-02T01:00:00Z").toISOString());
  });

  // The reason the join widened. Under the old admin-only filter this moved
  // neither field, so the change an admin most needs to notice was invisible.
  it("surfaces a requestor's own cancellation", async () => {
    const id = await insertPickup(
      "VR-2026-800102",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await insertEvent(id, {
      event_type: "cancelled",
      actor_name: "Jimera, Arielle",
      actor_role: "associate",
      created_at: "2026-08-03T01:00:00Z",
    });

    const row = await findRow("VR-2026-800102");
    expect(row.updatedBy).toBe("Jimera, Arielle");
    expect(row.updatedAt).not.toBeNull();
  });

  // `created_at` is set explicitly: events written in one transaction share a
  // timestamp, and an ordering assertion resting on insertion order is flaky.
  it("reports the most recent of several events", async () => {
    const id = await insertPickup(
      "VR-2026-800103",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await insertEvent(id, {
      event_type: "approved",
      actor_name: "Balandra, Ivy",
      actor_role: "admin_support",
      created_at: "2026-08-02T01:00:00Z",
    });
    await insertEvent(id, {
      event_type: "driver_reassigned",
      actor_name: "Abanto, Norlyn",
      actor_role: "admin_support",
      created_at: "2026-08-05T09:00:00Z",
    });

    const row = await findRow("VR-2026-800103");
    expect(row.updatedBy).toBe("Abanto, Norlyn");
    expect(row.updatedAt).toBe(new Date("2026-08-05T09:00:00Z").toISOString());
  });
});

describe("requestor-facing status", () => {
  it("shows an admin the real reassigned status", async () => {
    await insertReassigned("VR-2026-800090", arielleId);
    const rows = await listReservations(db, { all: true });
    expect(rows.find((row) => row.id === "VR-2026-800090")?.status).toBe(
      "Approved - Driver Reassigned",
    );
  });

  // The leak test. Without the mapping this returns the internal status and
  // every other test in the suite stays green.
  it("shows the requestor plain Approved", async () => {
    await insertReassigned("VR-2026-800091", arielleId);
    const rows = await listReservations(db, { requestorUserId: arielleId });
    expect(rows.find((row) => row.id === "VR-2026-800091")?.status).toBe(
      "Approved",
    );
  });
});

describe("listReservations scoping", () => {
  it("returns only the requestor's own rows for a user scope, newest first", async () => {
    await insertPickup("VR-2026-800001", arielleId, "2026-08-01T01:00:00Z");
    await insertPickup("VR-2026-800002", marcoId, "2026-08-02T01:00:00Z");
    await insertPickup("VR-2026-800003", arielleId, "2026-08-03T01:00:00Z");

    const own = await listReservations(db, { requestorUserId: arielleId });
    expect(own.map((r) => r.id)).toEqual(["VR-2026-800003", "VR-2026-800001"]);

    const all = await listReservations(db, { all: true });
    expect(all).toHaveLength(3);
  });
});

describe("row projection", () => {
  it("maps enums, Manila wall-clock, and the standby to-column", async () => {
    await insertPickup("VR-2026-800004", arielleId, "2026-08-01T01:00:00Z");
    const [row] = await listReservations(db, { all: true });

    expect(row).toMatchObject({
      id: "VR-2026-800004",
      submittedAt: "2026-08-01T01:00:00.000Z",
      startDate: "2026-08-08", // 2026-08-07T22:30Z is 06:30 next day in Manila
      startTime: "06:30",
      endTime: null,
      site: "Manila",
      status: "Pending",
      mode: "pickup",
      from: "AGT Tower lobby",
      to: "GLS Building",
      purpose: "Travel-Related (Airport Transfers)",
      details: "Repo test pickup trip.",
      requestor: "Jimera, Arielle",
      updatedBy: null,
      remarks: null,
      driver: null,
      firstAssignedAt: null,
    });
  });

  it("derives remarks from a modified event", async () => {
    const id = await insertPickup(
      "VR-2026-800005",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await db
      .insertInto("reservation_events")
      .values({
        reservation_id: id,
        actor_user_id: arielleId,
        actor_name: "Jimera, Arielle",
        actor_role: "associate",
        event_type: "modified",
        created_at: new Date("2026-08-01T03:00:00Z"),
      })
      .execute();

    const [row] = await listReservations(db, { all: true });
    expect(row.remarks).toBe(CHANGED_TRIP_DETAILS_REMARK);
    // A requestor's own edit DOES move both fields. The lateral join used to
    // filter on `actor_role = 'admin_support'`, which hid the changes an admin
    // scanning the Master List most needs to notice.
    expect(row.updatedBy).toBe("Jimera, Arielle");
    expect(row.updatedAt).toBe(new Date("2026-08-01T03:00:00Z").toISOString());
  });

  it("derives firstAssignedAt from the FIRST driver_assigned event and updatedBy from the latest admin event", async () => {
    const id = await insertPickup(
      "VR-2026-800006",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await db
      .updateTable("reservations")
      .set({
        status: "approved",
        assigned_driver_id: driverId,
        assigned_van_id: vanId,
      })
      .where("id", "=", id)
      .execute();

    const adminEvent = (type: string, at: string, name = "Abanto, Norlyn") =>
      db
        .insertInto("reservation_events")
        .values({
          reservation_id: id,
          actor_user_id: adminId,
          actor_name: name,
          actor_role: "admin_support",
          event_type: type,
          created_at: new Date(at),
        })
        .execute();

    await adminEvent("driver_assigned", "2026-08-01T05:00:00Z");
    await adminEvent("approved", "2026-08-01T05:00:00Z");
    // A later reassignment must NOT move firstAssignedAt:
    await adminEvent(
      "driver_reassigned",
      "2026-08-02T09:00:00Z",
      "Buenaflor, Zara",
    );

    const [row] = await listReservations(db, { all: true });
    expect(row.firstAssignedAt).toBe("2026-08-01T05:00:00.000Z");
    expect(row.updatedBy).toBe("Buenaflor, Zara");
    expect(row.driver).toBe("Villanueva, Rey");
    expect(row.status).toBe("Approved");
  });
});

describe("getReservationDetail", () => {
  it("returns null for an unknown reference", async () => {
    expect(await getReservationDetail(db, "VR-2026-999999")).toBeNull();
  });

  it("projects the full detail with ordered passengers and the driver assignment", async () => {
    const id = await insertPickup(
      "VR-2026-800007",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await db
      .updateTable("reservations")
      .set({
        status: "approved",
        assigned_driver_id: driverId,
        assigned_van_id: vanId,
      })
      .where("id", "=", id)
      .execute();
    await db
      .insertInto("reservation_events")
      .values({
        reservation_id: id,
        actor_user_id: adminId,
        actor_name: "Abanto, Norlyn",
        actor_role: "admin_support",
        event_type: "approved",
        created_at: new Date("2026-08-04T09:20:00Z"),
      })
      .execute();
    await db
      .insertInto("reservation_passengers")
      .values([
        {
          reservation_id: id,
          domain_id: "AM10394",
          name: "Dizon, Marco",
          position: 2,
        },
        {
          reservation_id: id,
          domain_id: "AJ29104",
          name: "Jimera, Arielle",
          position: 1,
        },
      ])
      .execute();

    const found = await getReservationDetail(db, "VR-2026-800007");
    expect(found).not.toBeNull();
    expect(found?.requestorUserId).toBe(arielleId);
    expect(found?.detail).toMatchObject({
      id: "VR-2026-800007",
      requestorEmail: "arielle.jimera@example.invalid",
      requestorMobile: "09567567122",
      purpose: "Travel-Related (Airport Transfers)",
      details: "Repo test pickup trip.",
      towerHead: null,
      pickupPoint: "AGT Tower lobby",
      dropoffPoint: "GLS Building",
      endDate: null,
      vendor: null,
      costPhp: null,
      rejectionReason: null,
      updatedAt: "2026-08-04T09:20:00.000Z",
      assignedDriver: {
        source: "roster",
        id: driverId,
        name: "Villanueva, Rey",
        mobile: "09171234567",
        shift: "11AM-11PM",
      },
    });
    expect(found?.detail.passengers).toEqual([
      { domainId: "AJ29104", name: "Jimera, Arielle" },
      { domainId: "AM10394", name: "Dizon, Marco" },
    ]);
  });

  it("projects standby fields: endDate/endTime, tower head, vendor, cost, to=Standby", async () => {
    await db
      .insertInto("reservations")
      .values({
        reference_no: "VR-2026-800008",
        ride_mode: "standby",
        status: "pending",
        site: "iloilo",
        requestor_user_id: arielleId,
        requestor_name: "Salcedo, Liza",
        requestor_email: "liza.salcedo@example.invalid",
        requestor_mobile: "09567567122",
        purpose: "Others",
        details: "Repo test standby trip.",
        start_at: new Date("2026-08-09T02:00:00Z"), // 10:00 Manila
        end_at: new Date("2026-08-09T05:00:00Z"), // 13:00 Manila
        pickup_location: "AGT Tower lobby",
        approving_tower_head: "Abanto, Norlyn",
        vendor: "Metro Fleet Services",
        cost_php: 6400,
      })
      .execute();

    const found = await getReservationDetail(db, "VR-2026-800008");
    expect(found?.detail).toMatchObject({
      to: "Standby",
      startTime: "10:00",
      endTime: "13:00",
      endDate: "2026-08-09",
      towerHead: "Abanto, Norlyn",
      vendor: "Metro Fleet Services",
      costPhp: 6400,
      assignedDriver: null,
    });
  });

  // Regression: the assignment guard used to key on driver_shift, so a driver
  // with no shift — every Iloilo driver in the real roster — silently produced
  // a null assignment, blanking mobile and van in the drawer with no error.
  it("returns a driver assignment even when the driver has no shift", async () => {
    const shiftlessId = (
      await db
        .insertInto("drivers")
        .values({
          name: "Ronald Japitana",
          mobile: "9063353656",
          site: "iloilo",
          shift: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;
    const id = await insertPickup(
      "VR-2026-800009",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await db
      .updateTable("reservations")
      .set({ assigned_driver_id: shiftlessId })
      .where("id", "=", id)
      .execute();

    const found = await getReservationDetail(db, "VR-2026-800009");

    expect(found?.detail.assignedDriver).toEqual({
      source: "roster",
      id: shiftlessId,
      name: "Ronald Japitana",
      mobile: "9063353656",
      shift: null,
    });
  });
});

describe("split van and rental assignments", () => {
  it("resolves a rental driver's name onto the row", async () => {
    const id = await insertPickup(
      "VR-2026-800010",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await db
      .updateTable("reservations")
      .set({
        rental_driver_name: "Rental Ramos",
        rental_driver_mobile: "9171234567",
      })
      .where("id", "=", id)
      .execute();

    const rows = await listReservations(db, { all: true });
    const row = rows.find((r) => r.id === "VR-2026-800010");

    expect(row?.driver).toBe("Rental Ramos");
    expect(row?.driverSource).toBe("rental");
    // Null because a rental has no roster row — not because nobody is driving.
    expect(row?.driverId).toBeNull();
  });

  it("carries the roster driver's id and van number on the row", async () => {
    const id = await insertPickup(
      "VR-2026-800011",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await db
      .updateTable("reservations")
      .set({ assigned_driver_id: driverId, assigned_van_id: vanId })
      .where("id", "=", id)
      .execute();

    const rows = await listReservations(db, { all: true });
    const row = rows.find((r) => r.id === "VR-2026-800011");

    expect(row).toMatchObject({
      driver: "Villanueva, Rey",
      driverId,
      driverSource: "roster",
      vanLabel: "VAN-01",
      vanSource: "roster",
    });
  });

  it("labels a rental van by its number, falling back to the plate", async () => {
    const withNumber = await insertPickup(
      "VR-2026-800012",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await db
      .updateTable("reservations")
      .set({
        rental_van_number: "RENT-07",
        rental_plate: "RENT 0007",
        rental_car_type: "Toyota GL",
      })
      .where("id", "=", withNumber)
      .execute();

    const withoutNumber = await insertPickup(
      "VR-2026-800013",
      arielleId,
      "2026-08-02T01:00:00Z",
    );
    await db
      .updateTable("reservations")
      .set({ rental_plate: "RENT 0008", rental_car_type: "Toyota GL" })
      .where("id", "=", withoutNumber)
      .execute();

    const rows = await listReservations(db, { all: true });
    const numbered = rows.find((r) => r.id === "VR-2026-800012");
    const unnumbered = rows.find((r) => r.id === "VR-2026-800013");

    expect(numbered?.vanLabel).toBe("RENT-07");
    expect(numbered?.vanSource).toBe("rental");
    // The plate, not a blank cell: blank would read as "no van assigned".
    expect(unnumbered?.vanLabel).toBe("RENT 0008");
    expect(unnumbered?.vanSource).toBe("rental");
  });

  it("returns a roster van on the detail", async () => {
    const id = await insertPickup(
      "VR-2026-800014",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await db
      .updateTable("reservations")
      .set({ assigned_van_id: vanId })
      .where("id", "=", id)
      .execute();

    const found = await getReservationDetail(db, "VR-2026-800014");

    expect(found?.detail.assignedVan).toEqual({
      source: "roster",
      id: vanId,
      vanNumber: "VAN-01",
      plate: "ABC 1234",
      carType: "Toyota Hiace",
    });
  });

  it("returns rental unions on the detail, with a null van number", async () => {
    const id = await insertPickup(
      "VR-2026-800015",
      arielleId,
      "2026-08-01T01:00:00Z",
    );
    await db
      .updateTable("reservations")
      .set({
        rental_driver_name: "Rental Ramos",
        rental_driver_mobile: "9171234567",
        rental_plate: "RENT 0009",
        rental_car_type: "Toyota GL",
      })
      .where("id", "=", id)
      .execute();

    const found = await getReservationDetail(db, "VR-2026-800015");

    expect(found?.detail.assignedDriver).toEqual({
      source: "rental",
      name: "Rental Ramos",
      mobile: "9171234567",
    });
    expect(found?.detail.assignedVan).toEqual({
      source: "rental",
      vanNumber: null,
      plate: "RENT 0009",
      carType: "Toyota GL",
    });
  });

  it("leaves both unions null when nothing is assigned", async () => {
    await insertPickup("VR-2026-800016", arielleId, "2026-08-01T01:00:00Z");

    const found = await getReservationDetail(db, "VR-2026-800016");

    expect(found?.detail.assignedDriver).toBeNull();
    expect(found?.detail.assignedVan).toBeNull();
    expect(found?.detail.vanLabel).toBeNull();
    expect(found?.detail.driverSource).toBeNull();
    expect(found?.detail.vanSource).toBeNull();
  });
});
