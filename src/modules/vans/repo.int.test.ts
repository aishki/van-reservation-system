import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppRole } from "@/modules/auth/roles";
import type { RosterActor } from "@/modules/roster/types";
import {
  createVan,
  listVans,
  setVanActive,
  updateVan,
} from "@/modules/vans/repo";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

/** Marks this suite's write-path rows so cleanup cannot touch another's. */
const MARK = "roster-write-int";

/** roster_events.actor_user_id is a real FK to users(id) — the actor must be a real row. */
const ACTOR_DOMAIN_ID = "IB10001";
const ACTOR_NAME = "Balandra, Ivy";

let ACTOR: RosterActor;

async function seedActor(): Promise<string> {
  const row = await db
    .insertInto("users")
    .values({
      domain_id: ACTOR_DOMAIN_ID,
      name: ACTOR_NAME,
      email: "ivy.balandra@example.invalid",
      role: "admin_support",
    })
    .onConflict((oc) =>
      oc.column("domain_id").doUpdateSet({ name: ACTOR_NAME }),
    )
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

beforeAll(async () => {
  const actorUserId = await seedActor();
  ACTOR = {
    userId: actorUserId,
    domainId: ACTOR_DOMAIN_ID,
    email: "ivy.balandra@example.invalid",
    name: ACTOR_NAME,
    role: "admin_support",
  };
});

afterAll(async () => {
  // FK-safe order: roster_events references users; drop it first.
  await sql`delete from roster_events where actor_name = ${ACTOR_NAME}`.execute(
    db,
  );
  await sql`delete from vans where plate in ('INT-TEST-901', 'INT-TEST-902') or car_type = ${MARK}`.execute(
    db,
  );
  await sql`delete from users where domain_id = ${ACTOR_DOMAIN_ID}`.execute(db);
  await db.destroy();
});

beforeEach(async () => {
  await sql`delete from reservation_events`.execute(db);
  await sql`delete from reservation_passengers`.execute(db);
  await sql`delete from reservations`.execute(db);
  await sql`delete from vans`.execute(db);
});

describe("listVans", () => {
  it("projects wire values ordered by van number, including inactive vans", async () => {
    await db
      .insertInto("vans")
      .values([
        {
          van_number: "VAN-902",
          plate: "INT-TEST-902",
          car_type: "Urvan",
          site: "iloilo",
          active: false,
        },
        {
          van_number: "VAN-901",
          plate: "INT-TEST-901",
          car_type: "Hi Ace Super Grandia",
          site: "manila",
        },
      ])
      .execute();

    const vans = await listVans(db);
    expect(vans.map((v) => v.vanNumber)).toEqual(["VAN-901", "VAN-902"]);
    expect(vans[0]).toMatchObject({
      plate: "INT-TEST-901",
      carType: "Hi Ace Super Grandia",
      site: "Manila",
      active: true,
    });
    expect(vans[1]).toMatchObject({
      plate: "INT-TEST-902",
      carType: "Urvan",
      site: "Iloilo",
      active: false,
    });
    expect(typeof vans[0].id).toBe("string");
  });
});

describe("createVan", () => {
  it("inserts the van and logs a created event in the same transaction", async () => {
    const created = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const events = await db
      .selectFrom("roster_events")
      .selectAll()
      .where("target_id", "=", created.value.id)
      .execute();

    expect(events).toHaveLength(1);
    expect(events[0].target_table).toBe("vans");
    expect(events[0].event_type).toBe("created");
    expect(events[0].actor_name).toBe(ACTOR_NAME);
    // A creation IS the change; there is no before-state to diff.
    expect(events[0].changes).toBeNull();
  });

  it("creates the van active, so it can be assigned immediately", async () => {
    const created = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    expect(created.ok && created.value.active).toBe(true);
  });

  it("rolls the row back when the EVENT insert fails", async () => {
    // The atomicity direction that can really happen: the row is written, then
    // the event write fails. `actor_role` outside roster_events_actor_role_check
    // forces exactly that, after the van row is already inserted in the same
    // transaction. If the event write were moved outside the transaction, the
    // van would survive and this would fail.
    const bad: RosterActor = { ...ACTOR, role: "driver" as unknown as AppRole };

    await expect(
      createVan(
        db,
        {
          vanNumber: `VAN-${MARK}`,
          plate: `PLT-${MARK}`,
          carType: MARK,
          site: "Iloilo",
        },
        bad,
      ),
    ).rejects.toThrow();

    const rows = await db
      .selectFrom("vans")
      .select("id")
      .where("van_number", "=", `VAN-${MARK}`)
      .execute();
    expect(rows).toEqual([]);
  });
});

describe("createVan uniqueness", () => {
  it("refuses a duplicate van number, naming the vanNumber field", async () => {
    const first = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `P1-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    expect(first.ok).toBe(true);

    const second = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `P2-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.field).toBe("vanNumber");
    expect(second.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a duplicate plate, naming the plate field", async () => {
    await createVan(
      db,
      {
        vanNumber: `V1-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    const second = await createVan(
      db,
      {
        vanNumber: `V2-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.field).toBe("plate");
  });

  it("writes NO event when the insert is refused", async () => {
    // The atomicity claim: a trail entry for a write that did not happen would
    // make the log lie.
    await createVan(
      db,
      {
        vanNumber: `V3-${MARK}`,
        plate: `PLT2-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    const before = await db
      .selectFrom("roster_events")
      .select(db.fn.countAll().as("n"))
      .where("target_table", "=", "vans")
      .executeTakeFirstOrThrow();

    await createVan(
      db,
      {
        vanNumber: `V4-${MARK}`,
        plate: `PLT2-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );

    const after = await db
      .selectFrom("roster_events")
      .select(db.fn.countAll().as("n"))
      .where("target_table", "=", "vans")
      .executeTakeFirstOrThrow();
    expect(after.n).toEqual(before.n);
  });
});

describe("updateVan", () => {
  it("logs only the fields that moved, with both sides", async () => {
    const created = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await updateVan(db, created.value.id, { carType: `${MARK}-2` }, ACTOR);

    const event = await db
      .selectFrom("roster_events")
      .selectAll()
      .where("target_id", "=", created.value.id)
      .where("event_type", "=", "updated")
      .executeTakeFirstOrThrow();

    // Wrapped in `{ fields }` — the shape `parseChanges` reads, matching
    // `reservation_events`. A bare array is rejected by its first line.
    expect(event.changes).toEqual({
      fields: [
        { field: "carType", label: "Car type", from: MARK, to: `${MARK}-2` },
      ],
    });
  });

  it("writes NO event when the patch changes nothing", async () => {
    const created = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await updateVan(db, created.value.id, { carType: MARK }, ACTOR);

    const events = await db
      .selectFrom("roster_events")
      .selectAll()
      .where("target_id", "=", created.value.id)
      .where("event_type", "=", "updated")
      .execute();
    expect(events).toEqual([]);
  });

  it("returns NOT_FOUND for an id that does not exist", async () => {
    const result = await updateVan(
      db,
      "00000000-0000-0000-0000-0000000000ff",
      { carType: MARK },
      ACTOR,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("refuses a patch that collides with another van's number", async () => {
    const first = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    const second = await createVan(
      db,
      {
        vanNumber: `VAN2-${MARK}`,
        plate: `PLT2-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    if (!first.ok || !second.ok) throw new Error("setup failed");

    const result = await updateVan(
      db,
      second.value.id,
      { vanNumber: `VAN-${MARK}` },
      ACTOR,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe("vanNumber");

    // No event for a write the database refused.
    const events = await db
      .selectFrom("roster_events")
      .selectAll()
      .where("target_id", "=", second.value.id)
      .where("event_type", "=", "updated")
      .execute();
    expect(events).toEqual([]);
  });

  it("refuses a patch that collides with another van's plate", async () => {
    const first = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    const second = await createVan(
      db,
      {
        vanNumber: `VAN2-${MARK}`,
        plate: `PLT2-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    if (!first.ok || !second.ok) throw new Error("setup failed");

    const result = await updateVan(
      db,
      second.value.id,
      { plate: `PLT-${MARK}` },
      ACTOR,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe("plate");

    // No event for a write the database refused.
    const events = await db
      .selectFrom("roster_events")
      .selectAll()
      .where("target_id", "=", second.value.id)
      .where("event_type", "=", "updated")
      .execute();
    expect(events).toEqual([]);
  });

  it("has no way to change `active` through updateVan", async () => {
    // Activation is set*Active's exclusive concern. Before this was enforced,
    // a patch carrying `active` flipped the row and logged an `updated` event
    // that described only the other fields — a state change with no trail.
    const created = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    // @ts-expect-error `active` is deliberately not part of VanPatch.
    await updateVan(db, created.value.id, { active: false }, ACTOR);

    const row = await db
      .selectFrom("vans")
      .select("active")
      .where("id", "=", created.value.id)
      .executeTakeFirstOrThrow();
    expect(row.active).toBe(true);
  });
});

describe("setVanActive", () => {
  it("logs deactivated, then reactivated — not updated", async () => {
    const created = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await setVanActive(db, created.value.id, false, ACTOR);
    await setVanActive(db, created.value.id, true, ACTOR);

    const types = await db
      .selectFrom("roster_events")
      .select("event_type")
      .where("target_id", "=", created.value.id)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();

    expect(types.map((t) => t.event_type)).toEqual([
      "created",
      "deactivated",
      "reactivated",
    ]);
  });

  it("leaves a deactivated van visible to listVans", async () => {
    // History must keep rendering — an old trip has to show the van that ran
    // it. listVans deliberately returns inactive rows.
    const created = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");
    await setVanActive(db, created.value.id, false, ACTOR);

    const vans = await listVans(db);
    expect(vans.find((v) => v.id === created.value.id)?.active).toBe(false);
  });

  // The roster table computes `!row.active` from cached query data, so a stale
  // table retires a van that is already retired — see `setDriverActive`.
  it("writes no event when the row already holds that value", async () => {
    const created = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await setVanActive(db, created.value.id, false, ACTOR);
    const again = await setVanActive(db, created.value.id, false, ACTOR);

    expect(again.ok).toBe(true);
    const types = await db
      .selectFrom("roster_events")
      .select("event_type")
      .where("target_id", "=", created.value.id)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    expect(types.map((t) => t.event_type)).toEqual(["created", "deactivated"]);
  });

  it("writes no event when reactivating an already-active row", async () => {
    const created = await createVan(
      db,
      {
        vanNumber: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        carType: MARK,
        site: "Iloilo",
      },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await setVanActive(db, created.value.id, true, ACTOR);

    const types = await db
      .selectFrom("roster_events")
      .select("event_type")
      .where("target_id", "=", created.value.id)
      .execute();
    expect(types.map((t) => t.event_type)).toEqual(["created"]);
  });
});
