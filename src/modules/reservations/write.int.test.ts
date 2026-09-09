import { sql } from "kysely";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EM_DASH, formatPlainDateTime } from "@/lib/tz";
import { type BookingDraft, MESSAGES } from "@/modules/reservations/draft";
import { getReservationDetail } from "@/modules/reservations/repo";
import { CHANGED_TRIP_DETAILS_REMARK } from "@/modules/reservations/types";
import {
  cancelReservation,
  decideReservation,
  submitBooking,
  WRITE_MESSAGES,
  type WriteActor,
} from "@/modules/reservations/write";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  // beforeEach cleans before every test but nothing runs after the LAST one —
  // without this, these rows (the ZW9000x users, the two drivers, and the
  // reference_counters this suite advances) leak into whichever int file runs
  // next under fileParallelism: false. Same shape as the f9bc136 / 3925150 /
  // 038f891 leak fixes, in FK-safe order.
  await sql`delete from notification_outbox`.execute(db);
  await sql`delete from notification_events`.execute(db);
  await sql`delete from reservation_events`.execute(db);
  await sql`delete from reservation_passengers`.execute(db);
  await sql`delete from reservations`.execute(db);
  await sql`delete from drivers`.execute(db);
  await sql`delete from vans`.execute(db);
  await sql`delete from admin_whitelist where email like '%@wnotify.invalid'`.execute(
    db,
  );
  await sql`delete from users where domain_id in ('ZW90001', 'ZW90002')`.execute(
    db,
  );
  await db.deleteFrom("reference_counters").execute();
  await db.destroy();
});

/** A fixed submission instant, so every reference in this file is predictable. */
const NOW = new Date("2026-09-01T02:00:00Z");

let requestor: WriteActor;
let other: WriteActor;
let admin: WriteActor;
let driverId: string;
let secondDriverId: string;
let inactiveDriverId: string;
let vanId: string;
let otherVanId: string;
let inactiveVanId: string;

beforeEach(async () => {
  await sql`delete from notification_outbox`.execute(db);
  await sql`delete from notification_events`.execute(db);
  await sql`delete from reservation_events`.execute(db);
  await sql`delete from reservation_passengers`.execute(db);
  await sql`delete from reservations`.execute(db);
  await sql`delete from drivers`.execute(db);
  await sql`delete from vans`.execute(db);
  await sql`delete from users where domain_id in ('ZW90001', 'ZW90002')`.execute(
    db,
  );
  await sql`delete from admin_whitelist where email like '%@wnotify.invalid'`.execute(
    db,
  );
  await db.deleteFrom("reference_counters").execute();

  // A known Manila admin, so the notification tests can assert on an address
  // they own rather than coupling to whatever ADMIN_WHITELIST_SEED holds.
  await db
    .insertInto("admin_whitelist")
    .values({
      full_name: "ZZ Notify Admin",
      email: "zz.admin@wnotify.invalid",
      domain_id: "ZW99001",
      site: "manila",
    })
    .execute();

  const owner = await db
    .insertInto("users")
    .values({
      domain_id: "ZW90001",
      name: "Jimera, Arielle",
      email: "arielle@example.invalid",
      role: "associate",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  requestor = {
    userId: owner.id,
    name: "Jimera, Arielle",
    email: "arielle@example.invalid",
    role: "associate",
  };

  const stranger = await db
    .insertInto("users")
    .values({
      domain_id: "ZW90002",
      name: "Dizon, Marco",
      email: "marco@example.invalid",
      role: "associate",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  other = {
    userId: stranger.id,
    name: "Dizon, Marco",
    email: "marco@example.invalid",
    role: "associate",
  };
  // The same person, acting as Admin Support — the role is what changes, so a
  // test that passes only because the ids differ is not testing the role.
  admin = { ...other, role: "admin_support" };

  const drivers = await db
    .insertInto("drivers")
    .values([
      {
        name: "Villanueva, Ruel",
        mobile: "09170000001",
        site: "manila",
        shift: "11AM-11PM",
      },
      {
        name: "Ramos, Ben",
        mobile: "09170000002",
        site: "manila",
        shift: "11PM-11AM",
      },
      {
        name: "Retired, Ron",
        mobile: "09170000003",
        site: "manila",
        shift: null,
        active: false,
      },
    ])
    .returning(["id", "name"])
    .execute();
  driverId = drivers[0].id;
  secondDriverId = drivers[1].id;
  inactiveDriverId = drivers[2].id;

  const vans = await db
    .insertInto("vans")
    .values([
      {
        van_number: "VAN-01",
        plate: "TST 0001",
        car_type: "Toyota Hiace",
        site: "manila",
      },
      {
        van_number: "VAN-02",
        plate: "TST 0002",
        car_type: "Toyota Grandia",
        site: "manila",
      },
      {
        van_number: "VAN-99",
        plate: "TST 0099",
        car_type: "Toyota Hiace",
        site: "manila",
        active: false,
      },
    ])
    .returning("id")
    .execute();
  vanId = vans[0].id;
  otherVanId = vans[1].id;
  inactiveVanId = vans[2].id;
});

function pickupTrip(overrides: Record<string, string> = {}) {
  return {
    purpose: "Travel-Related (Airport Transfers)",
    details: "Airport transfer for the site visit.",
    towerHead: "",
    passengers: [
      { domainId: "aj29104", name: " Jimera, Arielle " },
      { domainId: "AM10394", name: "Dizon, Marco" },
    ],
    pickupDate: "2026-09-10",
    pickupTime: "06:30",
    dropoffPoint: "AGT Building",
    pickupPoint: "GLS Tower lobby",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    ...overrides,
  };
}

function standbyTrip() {
  return {
    purpose: "Others",
    details: "Standby coverage for the offsite.",
    towerHead: "Abanto, Norlyn",
    passengers: [{ domainId: "AJ29104", name: "Jimera, Arielle" }],
    pickupDate: "",
    pickupTime: "",
    dropoffPoint: "",
    pickupPoint: "AGT Tower lobby",
    startDate: "2026-09-10",
    endDate: "2026-09-11",
    startTime: "17:30",
    endTime: "01:00",
  };
}

const pickupDraft = (trips = [pickupTrip()]): BookingDraft => ({
  mode: "pickup",
  site: "Manila",
  mobile: "0917 111 2222",
  trips,
});

const standbyDraft = (): BookingDraft => ({
  mode: "standby",
  site: "Iloilo",
  mobile: "09171112222",
  trips: [standbyTrip()],
});

/** Submits and unwraps, for the tests whose subject is what happens next. */
async function submitted(draft: BookingDraft = pickupDraft()) {
  const result = await submitBooking(db, requestor, draft, NOW);
  if (!result.ok) throw new Error(`submit failed: ${result.error.message}`);
  return result.value[0];
}

function eventsOf(reference: string) {
  return db
    .selectFrom("reservation_events as e")
    .innerJoin("reservations as r", "r.id", "e.reservation_id")
    .select(["e.event_type", "e.actor_name", "e.actor_role", "e.changes"])
    .where("r.reference_no", "=", reference)
    .orderBy("e.created_at", "asc")
    .execute();
}

/**
 * `submitted` first, then the rest as a SET.
 *
 * `eventsOf` orders by `created_at` with no tiebreaker, and every row one
 * `decideReservation` writes lands in a single insert sharing one `now()` — so
 * their relative order is whatever the scan happens to return, not something the
 * schema guarantees. `submitted` is a separate transaction, so it is genuinely
 * first and still asserted as such.
 */
async function expectEvents(reference: string, decided: string[]) {
  const types = (await eventsOf(reference)).map((e) => e.event_type);
  expect(types).toHaveLength(decided.length + 1);
  expect(types[0]).toBe("submitted");
  expect(types.slice(1)).toEqual(expect.arrayContaining(decided));
}

function rowOf(reference: string) {
  return db
    .selectFrom("reservations")
    .selectAll()
    .where("reference_no", "=", reference)
    .executeTakeFirstOrThrow();
}

/**
 * The two roster sides of an assignment, so a test states only whose driver and
 * which van. Both are needed at approval: `reservations_approved_driver_check`
 * and `reservations_approved_van_check` are separate constraints, satisfied
 * independently.
 *
 * This replaces the `attachVan` helper that wrote `assigned_van_id` directly
 * while `write.ts` had no way to send a van.
 */
const rosterDriver = (id: string) =>
  ({ source: "roster", driverId: id }) as const;
const rosterVan = (id: string) => ({ source: "roster", vanId: id }) as const;

describe("submitBooking", () => {
  it("writes a pickup, its passengers and its submitted event", async () => {
    const result = await submitBooking(db, requestor, pickupDraft(), NOW);
    expect(result).toEqual({ ok: true, value: ["VR-2026-000001"] });

    const row = await rowOf("VR-2026-000001");
    expect(row.status).toBe("pending");
    expect(row.ride_mode).toBe("pickup");
    expect(row.site).toBe("manila");
    expect(row.dropoff_location).toBe("AGT Building");
    expect(row.end_at).toBeNull();
    expect(row.approving_tower_head).toBeNull();
    expect(row.version).toBe(1);
    // Normalised on the way in: the spaced input the mobile field accepts is
    // stored as digits, and a lower-cased Domain ID is stored upper.
    expect(row.requestor_mobile).toBe("09171112222");

    const passengers = await db
      .selectFrom("reservation_passengers")
      .select(["domain_id", "name", "position"])
      .where("reservation_id", "=", row.id)
      .orderBy("position", "asc")
      .execute();
    expect(passengers).toEqual([
      { domain_id: "AJ29104", name: "Jimera, Arielle", position: 1 },
      { domain_id: "AM10394", name: "Dizon, Marco", position: 2 },
    ]);

    expect(await eventsOf("VR-2026-000001")).toEqual([
      {
        event_type: "submitted",
        actor_name: "Jimera, Arielle",
        actor_role: "associate",
        changes: null,
      },
    ]);
  });

  it("stores the details a requestor typed, trimmed", async () => {
    const result = await submitBooking(
      db,
      requestor,
      pickupDraft([pickupTrip({ details: "  Offsite at Punta Villa.  " })]),
      NOW,
    );
    if (!result.ok) throw new Error("submit failed");

    const row = await rowOf(result.value[0]);
    expect(row.details).toBe("Offsite at Punta Villa.");
  });

  it("takes the requestor's identity from the actor, not the draft", async () => {
    await submitted();
    const row = await rowOf("VR-2026-000001");
    expect(row.requestor_user_id).toBe(requestor.userId);
    expect(row.requestor_name).toBe("Jimera, Arielle");
    expect(row.requestor_email).toBe("arielle@example.invalid");
  });

  it("writes a standby with its window and Tower Head, and no dropoff", async () => {
    await submitBooking(db, requestor, standbyDraft(), NOW);
    const row = await rowOf("VR-2026-000001");

    expect(row.ride_mode).toBe("standby");
    expect(row.approving_tower_head).toBe("Abanto, Norlyn");
    expect(row.dropoff_location).toBeNull();
    // 17:30 Manila on the 10th to 01:00 Manila on the 11th — a window that
    // crosses midnight, stored as two instants seven and a half hours apart.
    expect(row.end_at).not.toBeNull();
    const hours =
      ((row.end_at as Date).getTime() - row.start_at.getTime()) / 3_600_000;
    expect(hours).toBe(7.5);
  });

  it("issues one reference per trip, in order", async () => {
    const result = await submitBooking(
      db,
      requestor,
      pickupDraft([pickupTrip(), pickupTrip({ pickupTime: "09:00" })]),
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      value: ["VR-2026-000001", "VR-2026-000002"],
    });
  });

  it("refuses an incomplete draft with per-field errors and writes nothing", async () => {
    const result = await submitBooking(
      db,
      requestor,
      pickupDraft([pickupTrip({ dropoffPoint: "   " })]),
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(result.error.details).toMatchObject({
      trips: [{ missing: { dropoffPoint: true } }],
    });

    const rows = await db.selectFrom("reservations").select("id").execute();
    expect(rows).toHaveLength(0);
  });

  // Proves the server, not just the browser, stands between a blank details
  // paragraph and Task 14's `btrim` CHECK — without this guard the write would
  // reach the database and fail as an unhandled 500 instead of a clean 422.
  it("refuses a whitespace-only details and writes nothing", async () => {
    const result = await submitBooking(
      db,
      requestor,
      pickupDraft([pickupTrip({ details: "   " })]),
      NOW,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(result.error.details).toMatchObject({
      trips: [{ details: MESSAGES.detailsRequired }],
    });

    const rows = await db.selectFrom("reservations").select("id").execute();
    expect(rows).toHaveLength(0);
  });

  it("rolls the whole submission back when a later trip fails", async () => {
    // The second trip's date is unreadable, so the transaction aborts after the
    // first row was already inserted. Either both exist or neither does.
    await expect(
      submitBooking(
        db,
        requestor,
        pickupDraft([pickupTrip(), pickupTrip({ pickupDate: "not-a-date" })]),
        NOW,
      ),
    ).resolves.toMatchObject({ ok: false });

    const rows = await db.selectFrom("reservations").select("id").execute();
    expect(rows).toHaveLength(0);
  });
});

describe("cancelReservation", () => {
  it("cancels the owner's pending request, pairing reason with role", async () => {
    const reference = await submitted();
    const result = await cancelReservation(db, requestor, reference, "");
    expect(result.ok).toBe(true);

    const row = await rowOf(reference);
    expect(row.status).toBe("cancelled");
    // The schema requires reason and role together, so a blank reason becomes a
    // truthful default rather than a constraint violation.
    expect(row.cancellation_reason).toBe("Cancelled by the requestor.");
    expect(row.cancelled_by_role).toBe("associate");
    expect(row.version).toBe(2);

    const events = await eventsOf(reference);
    expect(events.map((e) => e.event_type)).toEqual(["submitted", "cancelled"]);
  });

  it("keeps a reason the requestor gave", async () => {
    const reference = await submitted();
    await cancelReservation(db, requestor, reference, "  Meeting moved.  ");
    expect((await rowOf(reference)).cancellation_reason).toBe("Meeting moved.");
  });

  it("records an admin cancellation under the admin's role", async () => {
    const reference = await submitted();
    await cancelReservation(db, admin, reference, "");
    const row = await rowOf(reference);
    expect(row.cancelled_by_role).toBe("admin_support");
    expect(row.cancellation_reason).toBe("Cancelled by Admin Support.");
  });

  it("gives a non-owner the same 404 as an unknown reference", async () => {
    const reference = await submitted();
    const stranger = await cancelReservation(db, other, reference, "");
    const missing = await cancelReservation(db, other, "VR-2026-999999", "");

    expect(stranger).toEqual(missing);
    expect(stranger.ok).toBe(false);
    // ...and the row is untouched.
    expect((await rowOf(reference)).status).toBe("pending");
  });

  it("cancels an approved request for the requestor", async () => {
    const reference = await submitted();
    await decideReservation(db, admin, reference, {
      version: 1,
      decision: "approve",
      rejectionReason: "",
      driver: rosterDriver(driverId),
      van: rosterVan(vanId),
      trip: null,
      costing: null,
    });

    const result = await cancelReservation(db, requestor, reference, "");
    expect(result.ok).toBe(true);

    const row = await rowOf(reference);
    expect(row.status).toBe("cancelled");
    expect(row.cancelled_by_role).toBe("associate");
    expect(row.cancellation_reason).toBe("Cancelled by the requestor.");
  });

  it("cancels an approved request for an admin", async () => {
    const reference = await submitted();
    await decideReservation(db, admin, reference, {
      version: 1,
      decision: "approve",
      rejectionReason: "",
      driver: rosterDriver(driverId),
      van: rosterVan(vanId),
      trip: null,
      costing: null,
    });

    const result = await cancelReservation(db, admin, reference, "");
    expect(result.ok).toBe(true);
    expect((await rowOf(reference)).status).toBe("cancelled");
  });

  it("still refuses to cancel a rejected request", async () => {
    const reference = await submitted();
    await decideReservation(db, admin, reference, {
      version: 1,
      decision: "reject",
      rejectionReason: "No van available.",
      driver: null,
      van: null,
      trip: null,
      costing: null,
    });

    const result = await cancelReservation(db, requestor, reference, "");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("INVALID_TRANSITION");
    expect(result.error.message).toBe(
      "Only a pending or approved request can be cancelled.",
    );
    expect((await rowOf(reference)).status).toBe("rejected");
  });

  it("refuses to cancel an already-cancelled request", async () => {
    const reference = await submitted();
    await cancelReservation(db, requestor, reference, "");

    const result = await cancelReservation(db, requestor, reference, "");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("decideReservation", () => {
  const decision = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    decision: null,
    rejectionReason: "",
    driver: null,
    van: null,
    trip: null,
    costing: null,
    ...overrides,
  });

  it("approves with a driver, and the read path sees both", async () => {
    const reference = await submitted();
    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({
        decision: "approve",
        driver: rosterDriver(driverId),
        van: rosterVan(vanId),
      }),
    );

    expect(result).toEqual({
      ok: true,
      value: { reference, status: "approved", version: 2 },
    });

    const found = await getReservationDetail(db, reference);
    expect(found?.detail.status).toBe("Approved");
    // The token the next PATCH must carry — the read path is where a client
    // gets it, so it has to move when the row does.
    expect(found?.detail.version).toBe(2);
    expect(found?.detail.driver).toBe("Villanueva, Ruel");
    // Was asserting the driver's own van_number; a driver no longer has one,
    // so what this now pins is the roster assignment the read path projects.
    expect(found?.detail.assignedDriver).toEqual({
      source: "roster",
      id: driverId,
      name: "Villanueva, Ruel",
      mobile: "09170000001",
      shift: "11AM-11PM",
    });
    expect(found?.detail.updatedBy).toBe("Dizon, Marco");
    // The TAT/SLA basis: set by the FIRST assignment.
    expect(found?.detail.firstAssignedAt).not.toBeNull();

    // Two assignment events, one per side: each side has its own first
    // assignment, and neither is folded into the other.
    await expectEvents(reference, [
      "driver_assigned",
      "van_assigned",
      "approved",
    ]);
    const events = await eventsOf(reference);
    expect(
      events
        .filter((e) => e.event_type !== "submitted")
        .every((e) => e.actor_role === "admin_support"),
    ).toBe(true);
  });

  it("refuses an approval with no driver and no van, leaving it pending", async () => {
    const reference = await submitted();
    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({ decision: "approve" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("VALIDATION_FAILED");
    // Both sides are named, because both are separate CHECK constraints.
    expect(result.error.details).toEqual({
      driverName: "Assign a driver before approving this request.",
      van: "Assign a van before approving this request.",
    });
    expect((await rowOf(reference)).status).toBe("pending");
  });

  it("refuses a rejection with no reason", async () => {
    const reference = await submitted();
    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({ decision: "reject", rejectionReason: "   " }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.details).toEqual({
      rejectionReason: "A reason is required before rejecting.",
    });
  });

  it("rejects with a reason, and records it on the event", async () => {
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({ decision: "reject", rejectionReason: " No van available. " }),
    );

    const row = await rowOf(reference);
    expect(row.status).toBe("rejected");
    expect(row.rejection_reason).toBe("No van available.");
    expect(row.assigned_driver_id).toBeNull();
  });

  it("refuses a driver who is not on the active roster", async () => {
    const reference = await submitted();
    for (const badDriver of [
      inactiveDriverId,
      "8ba7f3d0-1c2b-4a5e-9f60-2d1e3c4b5a60",
    ]) {
      const result = await decideReservation(
        db,
        admin,
        reference,
        decision({
          decision: "approve",
          driver: rosterDriver(badDriver),
          van: rosterVan(vanId),
        }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code).toBe("VALIDATION_FAILED");
    }
    expect((await rowOf(reference)).status).toBe("pending");
  });

  it("does not re-check a driver the request already carries", async () => {
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(driverId) }),
    );

    // The roster changes under an assignment that is already in place. Sending
    // it back unchanged must still be accepted — otherwise a driver deactivated
    // after being assigned would block every later save on the request,
    // including a rejection, which needs no driver at all.
    await db
      .updateTable("drivers")
      .set({ active: false })
      .where("id", "=", driverId)
      .execute();

    const rejected = await decideReservation(
      db,
      admin,
      reference,
      decision({
        version: 2,
        decision: "reject",
        rejectionReason: "Trip called off.",
        driver: rosterDriver(driverId),
      }),
    );
    expect(rejected.ok).toBe(true);
    expect((await rowOf(reference)).status).toBe("rejected");
  });

  it("refuses a second decision on a request the first one settled", async () => {
    const reference = await submitted();

    const first = await decideReservation(
      db,
      admin,
      reference,
      decision({
        decision: "approve",
        driver: rosterDriver(driverId),
        van: rosterVan(vanId),
      }),
    );
    expect(first.ok).toBe(true);

    // A second admin who had the drawer open still carries version 1. The
    // transition guard runs before the version guard, so this is the refusal it
    // gets — either way the first admin's approval stands.
    const second = await decideReservation(
      db,
      admin,
      reference,
      decision({ decision: "reject", rejectionReason: "Too late." }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected a refusal");
    expect(second.error.code).toBe("INVALID_TRANSITION");

    const row = await rowOf(reference);
    expect(row.status).toBe("approved");
    expect(row.rejection_reason).toBeNull();
  });

  it("conflicts when a stale version reaches a still-pending request", async () => {
    const reference = await submitted();

    // A field-only save advances the version without leaving `pending`.
    await decideReservation(
      db,
      admin,
      reference,
      decision({ trip: tripEdit({ purpose: "Onshore/Client Visit" }) }),
    );

    const stale = await decideReservation(
      db,
      admin,
      reference,
      decision({
        version: 1,
        decision: "approve",
        driver: rosterDriver(driverId),
        van: rosterVan(vanId),
      }),
    );
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("expected a refusal");
    expect(stale.error.code).toBe("VERSION_CONFLICT");
    expect((await rowOf(reference)).status).toBe("pending");
  });

  it("flags a changed trip, and names the fields on the event", async () => {
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({ trip: tripEdit({ pickupPoint: "AGT Tower lobby" }) }),
    );

    const events = await eventsOf(reference);
    expect(events.map((e) => e.event_type)).toEqual(["submitted", "modified"]);
    // Both sides, not just the field name — `changes` is the audit log's
    // record of what actually moved.
    expect(events[1].changes).toEqual({
      fields: [
        {
          field: "pickupPoint",
          label: "Pickup point",
          from: "GLS Tower lobby",
          to: "AGT Tower lobby",
        },
      ],
    });

    const found = await getReservationDetail(db, reference);
    expect(found?.detail.remarks).toBe(CHANGED_TRIP_DETAILS_REMARK);
    expect(found?.detail.pickupPoint).toBe("AGT Tower lobby");
  });

  // Details is the requestor's field, so an admin editing it must flag the
  // request the way purpose and pickup point already do.
  it("flags a changed details, and records the field on the event", async () => {
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({ trip: tripEdit({ details: "Corrected." }) }),
    );

    const events = await eventsOf(reference);
    expect(events.map((e) => e.event_type)).toEqual(["submitted", "modified"]);
    expect(events[1].changes).toEqual({
      fields: [
        {
          field: "details",
          label: "Details",
          from: "Airport transfer for the site visit.",
          to: "Corrected.",
        },
      ],
    });
    expect((await rowOf(reference)).details).toBe("Corrected.");
  });

  it("refuses a blank details on an admin edit", async () => {
    const reference = await submitted();
    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({ trip: tripEdit({ details: "   " }) }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("VALIDATION_FAILED");
    // Unwritten: the original details still stand.
    expect((await rowOf(reference)).details).toBe(
      "Airport transfer for the site visit.",
    );
  });

  it("does not flag a trip whose fields were resubmitted unchanged", async () => {
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({ trip: tripEdit() }),
    );

    const events = await eventsOf(reference);
    expect(events.map((e) => e.event_type)).toEqual(["submitted"]);
    expect(
      (await getReservationDetail(db, reference))?.detail.remarks,
    ).toBeNull();
  });

  it("does not flag admin-only bookkeeping as a changed trip", async () => {
    const reference = await submitted(standbyDraft());

    await decideReservation(
      db,
      admin,
      reference,
      decision({
        trip: {
          purpose: "Others",
          details: "Standby coverage for the offsite.",
          pickupPoint: "AGT Tower lobby",
          dropoffPoint: null,
          startDate: "2026-09-10",
          startTime: "17:30",
          endDate: "2026-09-11",
          endTime: "01:00",
          // The only change: fields the requestor never entered.
          vendor: "Prime Transport",
          costPhp: 8500,
        },
      }),
    );

    const row = await rowOf(reference);
    expect(row.vendor).toBe("Prime Transport");
    expect(row.cost_php).toBe(8500);
    const events = await eventsOf(reference);
    expect(events.map((e) => e.event_type)).toEqual(["submitted"]);
  });

  it("records a vendor and cost on a pickup, not just a standby", async () => {
    const reference = await submitted();

    await decideReservation(
      db,
      admin,
      reference,
      decision({
        trip: tripEdit({ vendor: "Prime Transport", costPhp: 3500 }),
      }),
    );

    const row = await rowOf(reference);
    expect(row.vendor).toBe("Prime Transport");
    expect(row.cost_php).toBe(3500);
    const events = await eventsOf(reference);
    expect(events.map((e) => e.event_type)).toEqual(["submitted"]);
  });

  it("records a reassignment separately, so the SLA clock does not move", async () => {
    const reference = await submitted();

    // Both saves leave the request pending — assigning a driver is not itself a
    // decision — so the reassignment path is reachable before approval.
    await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(driverId) }),
    );
    const before = (await getReservationDetail(db, reference))?.detail
      .firstAssignedAt;
    expect(before).not.toBeNull();

    await decideReservation(
      db,
      admin,
      reference,
      decision({ version: 2, driver: rosterDriver(secondDriverId) }),
    );

    const events = await eventsOf(reference);
    expect(events.map((e) => e.event_type)).toEqual([
      "submitted",
      "driver_assigned",
      "driver_reassigned",
    ]);

    const found = await getReservationDetail(db, reference);
    expect(found?.detail.driver).toBe("Ramos, Ben");
    expect(found?.detail.assignedDriver?.name).toBe("Ramos, Ben");
    // `firstAssignedAt` is min(driver_assigned), and a reassignment does not
    // write one — so turnaround is still measured from the first assignment.
    expect(found?.detail.firstAssignedAt).toBe(before);
  });

  it("assigns a van without touching the driver", async () => {
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(driverId) }),
    );

    // The van alone, the driver left out entirely — `null` means "leave this
    // side unchanged", which is the whole point of splitting the two.
    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({ version: 2, van: rosterVan(vanId) }),
    );
    expect(result.ok).toBe(true);

    const row = await rowOf(reference);
    expect(row.assigned_van_id).toBe(vanId);
    expect(row.assigned_driver_id).toBe(driverId);
  });

  it("clears the roster driver when a rental driver is set", async () => {
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(driverId) }),
    );

    await decideReservation(
      db,
      admin,
      reference,
      decision({
        version: 2,
        driver: {
          source: "rental",
          name: " Rental Ramos ",
          mobile: "0917 123 4567",
        },
      }),
    );

    const row = await rowOf(reference);
    // `reservations_driver_source_check` forbids holding both, so setting one
    // source has to null the other's columns.
    expect(row.assigned_driver_id).toBeNull();
    expect(row.rental_driver_name).toBe("Rental Ramos");
    expect(row.rental_driver_mobile).toBe("09171234567");
  });

  it("clears the rental driver when a roster driver replaces them", async () => {
    // The reverse direction of the case above. Without it, dropping the
    // `rental_driver_name: null` / `rental_driver_mobile: null` pair from
    // `driverColumns` leaves the whole suite green while a real save takes a
    // `reservations_driver_source_check` violation as a 500.
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({
        driver: {
          source: "rental",
          name: "Rental Ramos",
          mobile: "09171234567",
        },
      }),
    );
    const rented = await rowOf(reference);
    expect(rented.rental_driver_name).toBe("Rental Ramos");

    await decideReservation(
      db,
      admin,
      reference,
      decision({ version: 2, driver: rosterDriver(driverId) }),
    );
    const rostered = await rowOf(reference);
    expect(rostered.assigned_driver_id).toBe(driverId);
    expect(rostered.rental_driver_name).toBeNull();
    expect(rostered.rental_driver_mobile).toBeNull();
  });

  it("clears the roster van when a rental van replaces it", async () => {
    // The reverse direction again: `assigned_van_id: null` in `vanColumns` is
    // what keeps `reservations_van_source_check` satisfied here.
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({ van: rosterVan(vanId) }),
    );
    expect((await rowOf(reference)).assigned_van_id).toBe(vanId);

    await decideReservation(
      db,
      admin,
      reference,
      decision({
        version: 2,
        van: {
          source: "rental",
          vanNumber: "V-7",
          plate: "RENT 1",
          carType: "GL Grandia",
        },
      }),
    );
    const rented = await rowOf(reference);
    expect(rented.rental_plate).toBe("RENT 1");
    expect(rented.rental_van_number).toBe("V-7");
    expect(rented.assigned_van_id).toBeNull();
  });

  it("clears the rental van when a roster van replaces it", async () => {
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({
        van: {
          source: "rental",
          vanNumber: null,
          plate: "RENT 1",
          carType: "GL Grandia",
        },
      }),
    );
    const rented = await rowOf(reference);
    expect(rented.rental_plate).toBe("RENT 1");
    // The one optional rental field, and it cannot outlive its plate.
    expect(rented.rental_van_number).toBeNull();

    await decideReservation(
      db,
      admin,
      reference,
      decision({ version: 2, van: rosterVan(vanId) }),
    );
    const rostered = await rowOf(reference);
    expect(rostered.assigned_van_id).toBe(vanId);
    expect(rostered.rental_plate).toBeNull();
    expect(rostered.rental_car_type).toBeNull();
  });

  it("records van_assigned then van_reassigned", async () => {
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({ van: rosterVan(vanId) }),
    );
    await decideReservation(
      db,
      admin,
      reference,
      decision({ version: 2, van: rosterVan(otherVanId) }),
    );

    const events = await eventsOf(reference);
    expect(events.map((e) => e.event_type)).toEqual([
      "submitted",
      "van_assigned",
      "van_reassigned",
    ]);
  });

  it("refuses an unknown or inactive van", async () => {
    const reference = await submitted();
    for (const badVan of [
      inactiveVanId,
      "3c1d4e5f-6a7b-4c8d-9e01-2f3a4b5c6d70",
    ]) {
      const result = await decideReservation(
        db,
        admin,
        reference,
        decision({ van: rosterVan(badVan) }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.message).toBe(WRITE_MESSAGES.unknownVan);
    }
    expect((await rowOf(reference)).assigned_van_id).toBeNull();
  });

  it("does not re-check a van the request already carries", async () => {
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({ van: rosterVan(vanId) }),
    );

    // Same reasoning as the driver: a van retired AFTER it was assigned must
    // not block every later save on the request, including a rejection.
    await db
      .updateTable("vans")
      .set({ active: false })
      .where("id", "=", vanId)
      .execute();

    const rejected = await decideReservation(
      db,
      admin,
      reference,
      decision({
        version: 2,
        decision: "reject",
        rejectionReason: "Fleet down.",
        van: rosterVan(vanId),
      }),
    );
    expect(rejected.ok).toBe(true);
    expect((await rowOf(reference)).status).toBe("rejected");
  });

  // Mixing sources is intended: a relief driver in a company van, or an own
  // driver in a hired unit. Each CHECK constraint polices its own side.
  it("approves a rental driver in a roster van", async () => {
    const reference = await submitted();
    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({
        decision: "approve",
        driver: {
          source: "rental",
          name: "Rental Ramos",
          mobile: "9171234567",
        },
        van: rosterVan(vanId),
      }),
    );
    expect(result.ok).toBe(true);

    const row = await rowOf(reference);
    expect(row.status).toBe("approved");
    expect(row.rental_driver_name).toBe("Rental Ramos");
    expect(row.assigned_driver_id).toBeNull();
    expect(row.assigned_van_id).toBe(vanId);

    await expectEvents(reference, [
      "driver_assigned",
      "van_assigned",
      "approved",
    ]);
  });

  it("approves a roster driver in a rental van", async () => {
    const reference = await submitted();
    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({
        decision: "approve",
        driver: rosterDriver(driverId),
        van: {
          source: "rental",
          vanNumber: "V-7",
          plate: "RENT 1",
          carType: "GL Grandia",
        },
      }),
    );
    expect(result.ok).toBe(true);

    const row = await rowOf(reference);
    expect(row.status).toBe("approved");
    expect(row.assigned_driver_id).toBe(driverId);
    expect(row.assigned_van_id).toBeNull();
    expect(row.rental_van_number).toBe("V-7");
    expect(row.rental_plate).toBe("RENT 1");
  });

  it("refuses a rental whose identifying field is only whitespace", async () => {
    const reference = await submitted();
    for (const van of [
      {
        source: "rental" as const,
        vanNumber: null,
        plate: "  ",
        carType: "GL",
      },
      {
        source: "rental" as const,
        vanNumber: null,
        plate: "RENT 1",
        carType: " ",
      },
    ]) {
      const result = await decideReservation(
        db,
        admin,
        reference,
        decision({ van }),
      );
      expect(result.ok).toBe(false);
    }
    // The pair CHECK constraints would have taken a blank happily; nothing was
    // written, so the assignment mail can never meet an empty field.
    expect((await rowOf(reference)).rental_plate).toBeNull();
  });

  it("404s an unknown reference", async () => {
    const result = await decideReservation(
      db,
      admin,
      "VR-2026-999999",
      decision({
        decision: "approve",
        driver: rosterDriver(driverId),
        van: rosterVan(vanId),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

/** The pickup trip as it was submitted, so a test only states what it changes. */
describe("decideReservation reassignment", () => {
  const decision = (overrides: Record<string, unknown> = {}) => ({
    version: 2,
    decision: null,
    rejectionReason: "",
    driver: null,
    van: null,
    trip: null,
    costing: null,
    ...overrides,
  });

  /** A submitted request, approved with a roster driver and van. Version 2. */
  async function approved() {
    const reference = await submitted();
    const result = await decideReservation(db, admin, reference, {
      version: 1,
      decision: "approve",
      rejectionReason: "",
      driver: rosterDriver(driverId),
      van: rosterVan(vanId),
      trip: null,
      costing: null,
    });
    if (!result.ok) throw new Error(`approve failed: ${result.error.message}`);
    return reference;
  }

  it("moves an approved trip to the reassigned status", async () => {
    const reference = await approved();

    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(secondDriverId) }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("approved_reassigned");
  });

  // A save that re-sends the same assignment is not a reassignment. Relabelling
  // the row for it would make the status a record of "somebody pressed save".
  it("leaves the status alone when nothing moved", async () => {
    const reference = await approved();

    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(driverId) }),
    );

    expect(result.ok && result.value.status).toBe("approved");
  });

  it("stays reassigned across a second reassignment", async () => {
    const reference = await approved();

    await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(secondDriverId) }),
    );
    const second = await decideReservation(
      db,
      admin,
      reference,
      decision({ version: 3, van: rosterVan(otherVanId) }),
    );

    // The status names a condition — "the assignment changed since approval" —
    // not a count of how many times it did.
    expect(second.ok && second.value.status).toBe("approved_reassigned");
  });

  it("writes driver_reassigned, not a second driver_assigned", async () => {
    const reference = await approved();

    await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(secondDriverId) }),
    );

    const types = (await eventsOf(reference)).map((e) => e.event_type);
    expect(types).toContain("driver_reassigned");
    expect(types.filter((type) => type === "driver_assigned")).toHaveLength(1);
  });

  // `first_assigned_at` is min(driver_assigned) and is the TAT/SLA basis. A
  // reassignment must never reset it.
  it("does not move first_assigned_at", async () => {
    const reference = await approved();
    const before = (await getReservationDetail(db, reference))?.detail
      .firstAssignedAt;
    expect(before).not.toBeNull();

    await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(secondDriverId) }),
    );

    expect(
      (await getReservationDetail(db, reference))?.detail.firstAssignedAt,
    ).toBe(before);
  });

  it("tells the requestor the van assignment changed", async () => {
    const reference = await approved();

    await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(secondDriverId) }),
    );

    const queued = (await queuedFor(reference)).filter(
      (message) => message.event === "driver_changed",
    );
    expect(queued).toHaveLength(1);
    expect(queued[0].template).toBe("driver-assignment");
    expect(queued[0].recipient).toBe(requestor.email);
  });

  it("refuses a trip edit on an approved row", async () => {
    const reference = await approved();

    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({ trip: tripEdit() }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_TRANSITION");
  });

  // Costing is the one piece of the requestor's trip a reassign may still
  // touch — on its own, with neither side moving.
  it("records a vendor and cost with neither side moving", async () => {
    const reference = await approved();

    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({ costing: { vendor: "Metro Fleet Services", costPhp: 4200 } }),
    );

    expect(result.ok).toBe(true);
    const row = await rowOf(reference);
    expect(row.vendor).toBe("Metro Fleet Services");
    expect(row.cost_php).toBe(4200);
    // Still "approved" — a cost-only save is not a reassignment.
    expect(result.ok && result.value.status).toBe("approved");
  });

  it("records a vendor and cost alongside a driver reassignment", async () => {
    const reference = await approved();

    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({
        driver: rosterDriver(secondDriverId),
        costing: { vendor: "Metro Fleet Services", costPhp: 4200 },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("approved_reassigned");
    const row = await rowOf(reference);
    expect(row.vendor).toBe("Metro Fleet Services");
    expect(row.cost_php).toBe(4200);
  });

  // Vendor/cost are admin bookkeeping, never "Changed Trip Details" — the
  // same rule `applyTripEdit` enforces for a `full` save's `trip.vendor`.
  it("does not flag a cost-only reassign as a trip edit", async () => {
    const reference = await approved();

    await decideReservation(
      db,
      admin,
      reference,
      decision({ costing: { vendor: "Metro Fleet Services", costPhp: 4200 } }),
    );

    const types = (await eventsOf(reference)).map((e) => e.event_type);
    expect(types).not.toContain("modified");
  });

  it("refuses a negative cost on a reassign", async () => {
    const reference = await approved();

    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({ costing: { vendor: null, costPhp: -1 } }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe(WRITE_MESSAGES.costNegative);
    // Refused before the transaction, so nothing was written.
    expect((await rowOf(reference)).cost_php).toBeNull();
  });

  it("still refuses to approve a non-pending row", async () => {
    const reference = await approved();

    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({
        decision: "approve",
        driver: rosterDriver(secondDriverId),
        van: rosterVan(otherVanId),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_TRANSITION");
  });

  it("refuses a reassign on a cancelled row", async () => {
    const reference = await approved();
    const cancelled = await cancelReservation(
      db,
      admin,
      reference,
      "The trip was called off.",
    );
    expect(cancelled.ok).toBe(true);

    const result = await decideReservation(
      db,
      admin,
      reference,
      decision({
        version: (await rowOf(reference)).version,
        driver: rosterDriver(secondDriverId),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_TRANSITION");
  });
});

/** The `changes.fields` array of the named event, parsed. */
async function changesOf(reference: string, eventType: string) {
  const events = await eventsOf(reference);
  const event = events.find((candidate) => candidate.event_type === eventType);
  if (event === undefined) throw new Error(`no ${eventType} event`);
  const changes = event.changes as { fields?: unknown } | null;
  return (changes?.fields ?? []) as {
    field: string;
    label: string;
    from: string | null;
    to: string | null;
  }[];
}

describe("reservation_events.changes", () => {
  const decision = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    decision: null,
    rejectionReason: "",
    driver: null,
    van: null,
    trip: null,
    costing: null,
    ...overrides,
  });

  it("records both sides of every trip field that moved", async () => {
    const reference = await submitted();

    await decideReservation(
      db,
      admin,
      reference,
      decision({
        trip: tripEdit({
          purpose: "Training-Related",
          pickupPoint: "CGS Office",
        }),
      }),
    );

    expect(await changesOf(reference, "modified")).toEqual(
      expect.arrayContaining([
        {
          field: "purpose",
          label: "Purpose",
          from: "Travel-Related (Airport Transfers)",
          to: "Training-Related",
        },
        {
          field: "pickupPoint",
          label: "Pickup point",
          from: "GLS Tower lobby",
          to: "CGS Office",
        },
      ]),
    );
  });

  it("records nothing for a field that did not move", async () => {
    const reference = await submitted();

    await decideReservation(
      db,
      admin,
      reference,
      decision({ trip: tripEdit({ purpose: "Training-Related" }) }),
    );

    const changes = await changesOf(reference, "modified");
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe("purpose");
  });

  it("records a null `from` on a first assignment", async () => {
    const reference = await submitted();

    await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(driverId) }),
    );

    expect(await changesOf(reference, "driver_assigned")).toEqual([
      {
        field: "driver",
        label: "Driver",
        from: null,
        to: "Villanueva, Ruel",
      },
    ]);
  });

  it("names both drivers on a reassignment", async () => {
    const reference = await submitted();
    await decideReservation(
      db,
      admin,
      reference,
      decision({ driver: rosterDriver(driverId) }),
    );
    await decideReservation(
      db,
      admin,
      reference,
      decision({ version: 2, driver: rosterDriver(secondDriverId) }),
    );

    expect(await changesOf(reference, "driver_reassigned")).toEqual([
      {
        field: "driver",
        label: "Driver",
        from: "Villanueva, Ruel",
        to: "Ramos, Ben",
      },
    ]);
  });

  // A rental has no roster row, so the typed-in name IS the record.
  it("names a rental by its typed-in name", async () => {
    const reference = await submitted();

    await decideReservation(
      db,
      admin,
      reference,
      decision({
        driver: {
          source: "rental",
          name: "Rental Ramos",
          mobile: "9171234567",
        },
      }),
    );

    expect((await changesOf(reference, "driver_assigned"))[0].to).toBe(
      "Rental Ramos",
    );
  });

  it("names the van it was given", async () => {
    const reference = await submitted();

    await decideReservation(
      db,
      admin,
      reference,
      decision({ van: rosterVan(vanId) }),
    );

    const changes = await changesOf(reference, "van_assigned");
    expect(changes[0].field).toBe("van");
    expect(changes[0].from).toBeNull();
    expect(changes[0].to).not.toBeNull();
  });

  // Wall-clock, not an instant: a date rendered in the wrong zone reads as the
  // previous day for eight hours out of every twenty-four.
  it("formats a moved date in Manila wall-clock", async () => {
    const reference = await submitted();

    await decideReservation(
      db,
      admin,
      reference,
      decision({
        trip: tripEdit({ startDate: "2026-09-11", startTime: "14:45" }),
      }),
    );

    const start = (await changesOf(reference, "modified")).find(
      (change) => change.field === "startAt",
    );
    expect(start?.to).toBe(formatPlainDateTime("2026-09-11", "14:45"));
    expect(start?.to).not.toContain("T");
  });
});

function tripEdit(overrides: Record<string, unknown> = {}) {
  return {
    purpose: "Travel-Related (Airport Transfers)",
    details: "Airport transfer for the site visit.",
    pickupPoint: "GLS Tower lobby",
    dropoffPoint: "AGT Building",
    startDate: "2026-09-10",
    startTime: "06:30",
    endDate: null,
    endTime: null,
    vendor: null,
    costPhp: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Every queued message, newest last, with its event for context. */
function queuedFor(reference?: string) {
  let query = db
    .selectFrom("notification_outbox as o")
    .innerJoin("notification_events as e", "e.id", "o.event_id")
    .select([
      "o.template",
      "o.recipient",
      "o.cc",
      "o.payload",
      "e.event",
      "e.recipient_user_id",
      "e.title",
      "e.link",
    ])
    .orderBy("o.template");
  if (reference !== undefined) {
    query = query.where("e.link", "like", `%${reference}%`);
  }
  return query.execute();
}

const eventRows = () =>
  db
    .selectFrom("notification_events")
    .select(["event", "recipient_user_id", "title", "body", "link"])
    .execute();

describe("submitBooking notifications", () => {
  it("records one event and two mails per submission, not per trip", async () => {
    const draft = pickupDraft([pickupTrip(), pickupTrip(), pickupTrip()]);
    const created = await submitBooking(db, requestor, draft, NOW);
    if (!created.ok) throw new Error("submit failed");
    expect(created.value).toHaveLength(3);

    // Three reservations, ONE event, TWO mails.
    const events = await eventRows();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("submitted");
    expect(events[0].recipient_user_id).toBe(requestor.userId);

    const queued = await queuedFor();
    expect(queued.map((q) => q.template)).toEqual([
      "admin-new-request",
      "booking-submitted",
    ]);
  });

  it("addresses the digest to the requestor and the notice to the site's admins", async () => {
    await submitted();
    const queued = await queuedFor();

    const digest = queued.find((q) => q.template === "booking-submitted");
    expect(digest?.recipient).toBe(requestor.email);

    // Manila draft, so the Manila admin is on it and the requestor is not.
    const notice = queued.find((q) => q.template === "admin-new-request");
    expect(notice?.recipient).toContain("zz.admin@wnotify.invalid");
    expect(notice?.recipient).not.toContain(requestor.email);
  });

  it("carries every trip's reference in the digest payload", async () => {
    const draft = pickupDraft([pickupTrip(), pickupTrip()]);
    const created = await submitBooking(db, requestor, draft, NOW);
    if (!created.ok) throw new Error("submit failed");

    const digest = (await queuedFor()).find(
      (q) => q.template === "booking-submitted",
    );
    const payload = digest?.payload as { trips: { referenceId: string }[] };
    expect(payload.trips.map((t) => t.referenceId)).toEqual(created.value);
  });

  it("queues nothing when the submission rolls back", async () => {
    const draft = pickupDraft([pickupTrip(), pickupTrip()]);
    // An unreadable schedule fails the whole submission.
    draft.trips[1].pickupDate = "not-a-date";

    expect((await submitBooking(db, requestor, draft, NOW)).ok).toBe(false);

    // The assertion that proves the atomicity claim.
    expect(await eventRows()).toHaveLength(0);
    expect(await queuedFor()).toHaveLength(0);
  });
});

describe("decideReservation notifications", () => {
  it("records an approval to the requestor, copying the admins", async () => {
    const reference = await submitted();
    const decided = await decideReservation(db, admin, reference, {
      version: 1,
      decision: "approve",
      rejectionReason: "",
      driver: rosterDriver(driverId),
      van: rosterVan(vanId),
      trip: null,
      costing: null,
    });
    expect(decided.ok).toBe(true);

    const queued = await queuedFor(reference);
    expect(queued).toHaveLength(1);
    expect(queued[0].template).toBe("booking-status-change");
    expect(queued[0].event).toBe("approved");
    expect(queued[0].recipient).toBe(requestor.email);
    expect(queued[0].cc).toContain("zz.admin@wnotify.invalid");
    expect((queued[0].payload as { status: string }).status).toBe("Approved");
    expect(queued[0].link).toContain(reference);
  });

  it("records a rejection carrying the reason", async () => {
    const reference = await submitted();
    await decideReservation(db, admin, reference, {
      version: 1,
      decision: "reject",
      rejectionReason: "No van available.",
      driver: null,
      van: null,
      trip: null,
      costing: null,
    });

    const queued = await queuedFor(reference);
    expect(queued[0].event).toBe("rejected");
    const payload = queued[0].payload as {
      status: string;
      rejectionReason: string;
    };
    expect(payload.status).toBe("Rejected");
    expect(payload.rejectionReason).toBe("No van available.");
  });

  it("records the first driver assignment on a save that decides nothing", async () => {
    const reference = await submitted();
    const before = await rowOf(reference);

    await decideReservation(db, admin, reference, {
      version: before.version,
      decision: null,
      rejectionReason: "",
      driver: rosterDriver(driverId),
      van: null,
      trip: null,
      costing: null,
    });

    const queued = await queuedFor(reference);
    expect(queued).toHaveLength(1);
    expect(queued[0].template).toBe("driver-assignment");
    expect(queued[0].event).toBe("driver_assigned");
    expect((queued[0].payload as { change: string }).change).toBe("assigned");
  });

  it("records a driver change when the assignment moves", async () => {
    // Both saves happen while the request is still Pending: decideReservation
    // refuses a decided row (`isRequestorEditable`), so a driver cannot be
    // changed after approval at all today. See the note in the plan.
    const reference = await submitted();
    const first = await rowOf(reference);
    await decideReservation(db, admin, reference, {
      version: first.version,
      decision: null,
      rejectionReason: "",
      driver: rosterDriver(driverId),
      van: null,
      trip: null,
      costing: null,
    });

    const second = await rowOf(reference);
    await decideReservation(db, admin, reference, {
      version: second.version,
      decision: null,
      rejectionReason: "",
      driver: rosterDriver(secondDriverId),
      van: null,
      trip: null,
      costing: null,
    });

    const driverMail = (await queuedFor(reference)).filter(
      (q) => q.template === "driver-assignment",
    );
    expect(driverMail).toHaveLength(2);
    // Not a status change either time: the reservation is still Pending.
    expect(driverMail.map((m) => m.event).sort()).toEqual([
      "driver_assigned",
      "driver_changed",
    ]);
  });

  it("records the first van assignment on a save that decides nothing", async () => {
    const reference = await submitted();
    await decideReservation(db, admin, reference, {
      version: 1,
      decision: null,
      rejectionReason: "",
      driver: null,
      van: rosterVan(vanId),
      trip: null,
      costing: null,
    });

    const queued = await queuedFor(reference);
    expect(queued).toHaveLength(1);
    expect(queued[0].template).toBe("driver-assignment");
    expect((queued[0].payload as { change: string }).change).toBe("assigned");
    // The notice covers both sides, so its copy names neither: a van-only move
    // headed "Driver assigned" would be a false statement to a real person.
    expect(queued[0].title).toBe("Van assignment set");

    // The mail's "Assigned van" block, which nothing populated before Task 7:
    // no driver yet, so that half dashes and the plate still lands.
    const payload = queued[0].payload as {
      trips: { driver?: { name: string; plate: string } }[];
    };
    expect(payload.trips[0].driver?.plate).toBe("TST 0001");
    expect(payload.trips[0].driver?.name).toBe(EM_DASH);
  });

  it("reads a van added to an already-assigned trip as a change", async () => {
    // The notice covers both sides, so "first time" means the trip carried NO
    // assignment at all. Telling a requestor "assigned" twice would read as a
    // duplicate of the mail they already have.
    const reference = await submitted();
    await decideReservation(db, admin, reference, {
      version: 1,
      decision: null,
      rejectionReason: "",
      driver: rosterDriver(driverId),
      van: null,
      trip: null,
      costing: null,
    });
    await decideReservation(db, admin, reference, {
      version: 2,
      decision: null,
      rejectionReason: "",
      driver: null,
      van: rosterVan(vanId),
      trip: null,
      costing: null,
    });

    const mail = (await queuedFor(reference)).filter(
      (q) => q.template === "driver-assignment",
    );
    expect(mail.map((m) => m.event).sort()).toEqual([
      "driver_assigned",
      "driver_changed",
    ]);
  });

  it("stays silent on a save that changes neither side and decides nothing", async () => {
    const reference = await submitted();
    const before = await rowOf(reference);

    await decideReservation(db, admin, reference, {
      version: before.version,
      decision: null,
      rejectionReason: "",
      driver: null,
      van: null,
      trip: null,
      costing: null,
    });

    // A field edit is not news. Without the guard this would mail a rejection
    // with a blank reason.
    expect(await queuedFor(reference)).toHaveLength(0);
  });
});

describe("cancelReservation notifications", () => {
  it("tells the admins when the requestor cancels", async () => {
    const reference = await submitted();
    await cancelReservation(db, requestor, reference, "Not needed.");

    const queued = await queuedFor(reference);
    expect(queued).toHaveLength(1);
    expect(queued[0].event).toBe("cancelled");
    // Whoever did NOT act is the one who needs telling.
    expect(queued[0].recipient).toContain("zz.admin@wnotify.invalid");
    expect(queued[0].recipient).not.toContain(requestor.email);
    expect((queued[0].payload as { cancelledBy: string }).cancelledBy).toBe(
      "associate",
    );
  });

  it("tells the requestor when an admin cancels", async () => {
    const reference = await submitted();
    await cancelReservation(db, admin, reference, "Fleet down.");

    const queued = await queuedFor(reference);
    expect(queued[0].recipient).toBe(requestor.email);
    expect((queued[0].payload as { cancelledBy: string }).cancelledBy).toBe(
      "admin_support",
    );
  });

  it("puts the in-app notification on the requestor either way", async () => {
    const reference = await submitted();
    await cancelReservation(db, requestor, reference, "Not needed.");

    const cancelled = (await eventRows()).find((e) => e.event === "cancelled");
    // Their own action, but it belongs in their trip's history.
    expect(cancelled?.recipient_user_id).toBe(requestor.userId);
    expect(cancelled?.link).toContain(reference);
  });

  /**
   * A second Manila admin, distinct from `admin` (which shares `other`'s
   * user row) — the exclusion bug only shows up when the ACTOR themselves is
   * on the site's whitelist. `@wnotify.invalid` so `beforeEach`/`afterAll`'s
   * existing cleanup regex catches it without a new cleanup line.
   */
  async function approvedWithTwoAdmins() {
    await db
      .insertInto("admin_whitelist")
      .values({
        full_name: "MM Acting Admin",
        email: "mm.admin@wnotify.invalid",
        domain_id: "ZW99002",
        site: "manila",
      })
      .execute();
    const actingAdmin: WriteActor = {
      ...admin,
      email: "mm.admin@wnotify.invalid",
    };

    const reference = await submitted();
    await decideReservation(db, admin, reference, {
      version: 1,
      decision: "approve",
      rejectionReason: "",
      driver: rosterDriver(driverId),
      van: rosterVan(vanId),
      trip: null,
      costing: null,
    });
    return { reference, actingAdmin };
  }

  it("cc's the OTHER admins when an admin cancels an approved trip, excluding the actor", async () => {
    const { reference, actingAdmin } = await approvedWithTwoAdmins();
    const result = await cancelReservation(
      db,
      actingAdmin,
      reference,
      "Driver reassigned elsewhere.",
    );
    expect(result.ok).toBe(true);

    const queued = await queuedFor(reference);
    const cancelled = queued.find((q) => q.event === "cancelled");
    expect(cancelled?.recipient).toBe(requestor.email);
    expect(cancelled?.cc).toContain("zz.admin@wnotify.invalid");
    // The bug this fixes: the acting admin must not cc themselves.
    expect(cancelled?.cc).not.toContain("mm.admin@wnotify.invalid");
  });

  it("still reaches every site admin when a requestor cancels an approved trip", async () => {
    const { reference } = await approvedWithTwoAdmins();
    const result = await cancelReservation(db, requestor, reference, "");
    expect(result.ok).toBe(true);

    const queued = await queuedFor(reference);
    const cancelled = queued.find((q) => q.event === "cancelled");
    expect(cancelled?.recipient).toContain("zz.admin@wnotify.invalid");
    expect(cancelled?.recipient).toContain("mm.admin@wnotify.invalid");
    expect(cancelled?.recipient).not.toContain(requestor.email);
  });
});
