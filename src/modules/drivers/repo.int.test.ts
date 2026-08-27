import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppRole } from "@/modules/auth/roles";
import {
  createDriver,
  listDrivers,
  setDriverActive,
  updateDriver,
} from "@/modules/drivers/repo";
import type { RosterActor } from "@/modules/roster/types";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

/** Marks this suite's write-path rows so cleanup cannot touch another's. */
const WRITE_MARK = "Roster Write Test Driver";

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
  await sql`delete from drivers where name in ('Villanueva, Rey', 'Aguilar, Ben', ${WRITE_MARK})`.execute(
    db,
  );
  await sql`delete from users where domain_id = ${ACTOR_DOMAIN_ID}`.execute(db);
  await db.destroy();
});

beforeEach(async () => {
  await sql`delete from reservation_events`.execute(db);
  await sql`delete from reservation_passengers`.execute(db);
  await sql`delete from reservations`.execute(db);
  await sql`delete from drivers`.execute(db);
});

describe("listDrivers", () => {
  it("projects wire values ordered by name, including inactive drivers", async () => {
    await db
      .insertInto("drivers")
      .values([
        {
          name: "Villanueva, Rey",
          mobile: "09171234567",
          site: "manila",
          shift: "11AM-11PM",
        },
        {
          name: "Aguilar, Ben",
          mobile: "09171234571",
          site: "manila",
          // Null: the Iloilo drivers have no shift, and the projection must
          // carry that through rather than inventing one.
          shift: null,
          active: false,
        },
      ])
      .execute();

    const drivers = await listDrivers(db);
    expect(drivers.map((d) => d.name)).toEqual([
      "Aguilar, Ben",
      "Villanueva, Rey",
    ]);
    expect(drivers[0]).toMatchObject({
      mobile: "09171234571",
      site: "Manila",
      shift: null,
      active: false,
    });
    expect(typeof drivers[0].id).toBe("string");
  });
});

describe("createDriver", () => {
  it("inserts the driver and logs a created event in the same transaction", async () => {
    const created = await createDriver(
      db,
      { name: WRITE_MARK, mobile: "09171234567", site: "Iloilo", shift: null },
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
    expect(events[0].target_table).toBe("drivers");
    expect(events[0].event_type).toBe("created");
    expect(events[0].actor_name).toBe(ACTOR_NAME);
    // A creation IS the change; there is no before-state to diff.
    expect(events[0].changes).toBeNull();
  });

  it("creates the driver active, so they can be assigned immediately", async () => {
    const created = await createDriver(
      db,
      { name: WRITE_MARK, mobile: "09171234567", site: "Iloilo", shift: null },
      ACTOR,
    );
    expect(created.ok && created.value.active).toBe(true);
  });

  it("rolls the row back when the EVENT insert fails", async () => {
    // The atomicity direction that can really happen: the row is written, then
    // the event write fails. `actor_role` outside roster_events_actor_role_check
    // forces exactly that, after the driver row is already inserted in the same
    // transaction. If the event write were moved outside the transaction, the
    // driver would survive and this would fail.
    const bad: RosterActor = { ...ACTOR, role: "driver" as unknown as AppRole };

    await expect(
      createDriver(
        db,
        {
          name: WRITE_MARK,
          mobile: "09171234567",
          site: "Iloilo",
          shift: null,
        },
        bad,
      ),
    ).rejects.toThrow();

    const rows = await db
      .selectFrom("drivers")
      .select("id")
      .where("name", "=", WRITE_MARK)
      .execute();
    expect(rows).toEqual([]);
  });
});

describe("updateDriver", () => {
  it("logs only the fields that moved, with both sides", async () => {
    const created = await createDriver(
      db,
      { name: WRITE_MARK, mobile: "09171234567", site: "Iloilo", shift: null },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await updateDriver(db, created.value.id, { mobile: "09990001111" }, ACTOR);

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
        {
          field: "mobile",
          label: "Mobile",
          from: "09171234567",
          to: "09990001111",
        },
      ],
    });
  });

  it("writes NO event when the patch changes nothing", async () => {
    // An audit row for a change that never happened is worse than none: it
    // makes the log unreliable.
    const created = await createDriver(
      db,
      { name: WRITE_MARK, mobile: "09171234567", site: "Iloilo", shift: null },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await updateDriver(db, created.value.id, { mobile: "09171234567" }, ACTOR);

    const events = await db
      .selectFrom("roster_events")
      .selectAll()
      .where("target_id", "=", created.value.id)
      .where("event_type", "=", "updated")
      .execute();
    expect(events).toEqual([]);
  });

  it("returns NOT_FOUND for an id that does not exist", async () => {
    const result = await updateDriver(
      db,
      "00000000-0000-0000-0000-0000000000ff",
      { mobile: "09990001111" },
      ACTOR,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("has no way to change `active` through updateDriver", async () => {
    // Activation is set*Active's exclusive concern. Before this was enforced,
    // a patch carrying `active` flipped the row and logged an `updated` event
    // that described only the other fields — a state change with no trail.
    const created = await createDriver(
      db,
      { name: WRITE_MARK, mobile: "09171234567", site: "Iloilo", shift: null },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    // @ts-expect-error `active` is deliberately not part of DriverPatch.
    await updateDriver(db, created.value.id, { active: false }, ACTOR);

    const row = await db
      .selectFrom("drivers")
      .select("active")
      .where("id", "=", created.value.id)
      .executeTakeFirstOrThrow();
    expect(row.active).toBe(true);
  });
});

describe("setDriverActive", () => {
  it("logs deactivated, then reactivated — not updated", async () => {
    const created = await createDriver(
      db,
      { name: WRITE_MARK, mobile: "09171234567", site: "Iloilo", shift: null },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await setDriverActive(db, created.value.id, false, ACTOR);
    await setDriverActive(db, created.value.id, true, ACTOR);

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

  it("leaves a deactivated driver visible to listDrivers", async () => {
    // History must keep rendering — an old trip has to show the driver who ran
    // it. listDrivers deliberately returns inactive rows.
    const created = await createDriver(
      db,
      { name: WRITE_MARK, mobile: "09171234567", site: "Iloilo", shift: null },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");
    await setDriverActive(db, created.value.id, false, ACTOR);

    const drivers = await listDrivers(db);
    expect(drivers.find((d) => d.id === created.value.id)?.active).toBe(false);
  });

  // The roster table computes `!row.active` from cached query data, so a stale
  // table deactivates a driver that is already off. An audit row for a change
  // that did not happen makes the whole log untrustworthy — the same rule
  // `updateDriver` applies to an empty diff.
  it("writes no event when the row already holds that value", async () => {
    const created = await createDriver(
      db,
      { name: WRITE_MARK, mobile: "09171234567", site: "Iloilo", shift: null },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await setDriverActive(db, created.value.id, false, ACTOR);
    const again = await setDriverActive(db, created.value.id, false, ACTOR);

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
    const created = await createDriver(
      db,
      { name: WRITE_MARK, mobile: "09171234567", site: "Iloilo", shift: null },
      ACTOR,
    );
    if (!created.ok) throw new Error("setup failed");

    await setDriverActive(db, created.value.id, true, ACTOR);

    const types = await db
      .selectFrom("roster_events")
      .select("event_type")
      .where("target_id", "=", created.value.id)
      .execute();
    expect(types.map((t) => t.event_type)).toEqual(["created"]);
  });
});
