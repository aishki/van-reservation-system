import { sql } from "kysely";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  listRosterEvents,
  type RosterAuditQuery,
  type RosterAuditScope,
} from "@/modules/audit/roster-repo";
import { updateDriver } from "@/modules/drivers/repo";
import type { RosterActor } from "@/modules/roster/types";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

const ACTOR = "Balandra, Ivy";
/** Scopes this suite's van/admin fixtures so cleanup cannot touch another's. */
const MARK = "roster-audit-int";

/** Actor for tests that write through the real repo functions rather than
 * inserting `roster_events` rows directly. */
const ROSTER_ACTOR: RosterActor = {
  userId: null,
  domainId: "ZA90099",
  email: null,
  name: ACTOR,
  role: "admin_support",
};

afterAll(async () => {
  await cleanup();
  await db.destroy();
});

async function cleanup() {
  await sql`delete from roster_events`.execute(db);
  await sql`delete from drivers where name = 'Ronald Japitana'`.execute(db);
  await sql`delete from vans where car_type = ${MARK}`.execute(db);
  await sql`delete from admin_whitelist where full_name = ${MARK}`.execute(db);
}

let driverId: string;
let vanId: string;
let adminId: string;

beforeEach(async () => {
  await cleanup();

  driverId = (
    await db
      .insertInto("drivers")
      .values({
        name: "Ronald Japitana",
        mobile: "09171234567",
        site: "iloilo",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;

  vanId = (
    await db
      .insertInto("vans")
      .values({
        van_number: `VAN-${MARK}`,
        plate: `PLT-${MARK}`,
        car_type: MARK,
        site: "iloilo",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;

  adminId = (
    await db
      .insertInto("admin_whitelist")
      .values({ full_name: MARK, site: "iloilo", email: `${MARK}@x.invalid` })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
});

interface EventInput {
  target: "drivers" | "vans" | "admin_whitelist";
  targetId: string;
  eventType: string;
  actorName?: string;
  actorRole?: string;
  at: string;
  changes?: unknown;
}

async function event(input: EventInput): Promise<string> {
  const row = await db
    .insertInto("roster_events")
    .values({
      target_table: input.target,
      target_id: input.targetId,
      event_type: input.eventType,
      actor_name: input.actorName ?? ACTOR,
      actor_role: input.actorRole ?? "admin_support",
      created_at: new Date(input.at),
      changes:
        input.changes === undefined ? null : JSON.stringify(input.changes),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const BLANK: RosterAuditQuery = {
  eventType: null,
  actor: null,
  from: null,
  to: null,
  limit: 50,
  cursor: null,
};

/** Defaults to a holder, so the existing cases read the whole log. */
const list = (
  overrides: Partial<RosterAuditQuery> = {},
  scope: RosterAuditScope = { includeAdminTargets: true },
) => listRosterEvents(db, { ...BLANK, ...overrides }, scope);

describe("listRosterEvents", () => {
  it("names the subject by its CURRENT identity", async () => {
    // Deliberately different from reservation events, which snapshot display
    // strings at write time: a roster event describes an object that still
    // exists and is best identified by what it is called NOW. `changes` still
    // carries the historical before/after values.
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "created",
      at: "2026-08-05T01:00:00Z",
    });

    const entry = (await list()).entries[0];
    expect(entry.subject).toBe("Ronald Japitana");
    expect(entry.target).toBe("drivers");
  });

  it("resolves a van's subject by its current van number", async () => {
    await event({
      target: "vans",
      targetId: vanId,
      eventType: "updated",
      at: "2026-08-05T01:00:00Z",
    });

    const entry = (await list()).entries[0];
    expect(entry.subject).toBe(`VAN-${MARK}`);
    expect(entry.target).toBe("vans");
  });

  it("resolves an admin's subject by its current full name", async () => {
    await event({
      target: "admin_whitelist",
      targetId: adminId,
      eventType: "updated",
      at: "2026-08-05T01:00:00Z",
    });

    const entry = (await list()).entries[0];
    expect(entry.subject).toBe(MARK);
    expect(entry.target).toBe("admin_whitelist");
  });

  // Roster rows are never deleted, so this cannot normally happen — a
  // dangling target_id marks a broken invariant, not an expected case.
  it('marks the subject "(removed)" when no table joins the target_id', async () => {
    await event({
      target: "drivers",
      targetId: "00000000-0000-4000-8000-000000000000",
      eventType: "created",
      at: "2026-08-05T01:00:00Z",
    });

    expect((await list()).entries[0].subject).toBe("(removed)");
  });

  it("orders newest first", async () => {
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "created",
      at: "2026-08-01T01:00:00Z",
    });
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "updated",
      at: "2026-08-09T01:00:00Z",
    });
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "deactivated",
      at: "2026-08-05T01:00:00Z",
    });

    expect((await list()).entries.map((e) => e.eventType)).toEqual([
      "updated",
      "deactivated",
      "created",
    ]);
  });

  // The `id` tiebreak's whole purpose. Events written in one transaction share
  // a timestamp; ordering on it alone skips or repeats rows between pages.
  it("returns every row exactly once across pages when all share a created_at", async () => {
    const at = "2026-09-01T02:00:00Z";
    const inserted: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      inserted.push(
        await event({
          target: "drivers",
          targetId: driverId,
          eventType: "updated",
          at,
        }),
      );
    }

    const seen: string[] = [];
    let cursor = null as RosterAuditQuery["cursor"];
    for (let page = 0; page < 5; page += 1) {
      const result = await list({ limit: 2, cursor });
      seen.push(...result.entries.map((e) => e.id));
      cursor = result.nextCursor;
      if (cursor === null) break;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...inserted].sort());
  });

  it("returns a null nextCursor on the last page", async () => {
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "created",
      at: "2026-08-05T01:00:00Z",
    });

    expect((await list({ limit: 10 })).nextCursor).toBeNull();
  });

  it.each(["created", "deactivated"] as const)(
    "filters by event type %s",
    async (eventType) => {
      await event({
        target: "drivers",
        targetId: driverId,
        eventType: "created",
        at: "2026-08-01T01:00:00Z",
      });
      await event({
        target: "drivers",
        targetId: driverId,
        eventType: "deactivated",
        at: "2026-08-02T01:00:00Z",
      });

      const { entries } = await list({ eventType });
      expect(entries.map((e) => e.eventType)).toEqual([eventType]);
    },
  );

  it("filters by actor", async () => {
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "created",
      at: "2026-08-01T01:00:00Z",
    });
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "updated",
      actorName: "Abanto, Norlyn",
      at: "2026-08-02T01:00:00Z",
    });

    const { entries } = await list({ actor: "norlyn" });
    expect(entries.map((e) => e.actorName)).toEqual(["Abanto, Norlyn"]);
  });

  // Bounds are plain Manila dates; the column is timestamptz. An event at
  // 23:00 Manila on the `to` date must be INCLUDED.
  it("filters by an inclusive Manila date range", async () => {
    // 2026-08-05 15:00Z is 23:00 Manila the same day.
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "created",
      at: "2026-08-05T15:00:00Z",
    });
    // 2026-08-06 17:00Z is 01:00 Manila on the 7th — outside the range.
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "updated",
      at: "2026-08-06T17:00:00Z",
    });

    const { entries } = await list({ from: "2026-08-05", to: "2026-08-06" });
    expect(entries.map((e) => e.eventType)).toEqual(["created"]);
  });

  // The scope decision was admin actors only, and a scope that a query
  // parameter can widen is not a scope — same as `listAuditEntries`.
  it("omits an event whose actor is not admin_support", async () => {
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "created",
      actorRole: "associate",
      at: "2026-08-05T01:00:00Z",
    });

    expect((await list()).entries).toEqual([]);
  });

  it("caps the limit at MAX_AUDIT_LIMIT regardless of what is asked", async () => {
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "created",
      at: "2026-08-05T01:00:00Z",
    });

    const result = await list({ limit: 5000 });
    expect(result.entries.length).toBeLessThanOrEqual(100);
  });

  // Written through the REAL update path, not a hand-built `roster_events`
  // row: a payload assembled by this test proves nothing about whether the
  // writer (`recordRosterEvent`) and this reader (`parseChanges`) agree on the
  // wire shape. `updateDriver` is how a real roster change gets logged — the
  // regression this guards was the writer storing a bare array where the
  // reader expects `{ fields: [...] }`, wrapped, so it silently read back as
  // `kind: "none"` no matter what a test constructed by hand.
  it("parses the changes written by a real driver update", async () => {
    const result = await updateDriver(
      db,
      driverId,
      { mobile: "09172222222" },
      ROSTER_ACTOR,
    );
    if (!result.ok) throw new Error("setup failed");

    expect((await list()).entries[0].changes).toEqual({
      kind: "fields",
      changes: [
        {
          field: "mobile",
          // The driver was seeded in `beforeEach` with this exact mobile.
          from: "09171234567",
          to: "09172222222",
          label: "Mobile",
        },
      ],
    });
  });

  it("reads a created event with no changes as kind none", async () => {
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "created",
      at: "2026-08-05T01:00:00Z",
    });

    expect((await list()).entries[0].changes).toEqual({ kind: "none" });
  });
});

/**
 * The second scope. `/api/admins` and `/roster` both withhold the whitelist
 * from a plain `admin_support` user; an `admin_whitelist` event names that
 * admin in `subject` and carries their email, Domain ID and `super_admin`
 * state in `changes`, so without this the log hands it all back.
 */
describe("listRosterEvents admin-target scope", () => {
  beforeEach(async () => {
    await event({
      target: "drivers",
      targetId: driverId,
      eventType: "created",
      at: "2026-08-05T01:00:00Z",
    });
    await event({
      target: "vans",
      targetId: vanId,
      eventType: "created",
      at: "2026-08-05T02:00:00Z",
    });
    await event({
      target: "admin_whitelist",
      targetId: adminId,
      eventType: "updated",
      at: "2026-08-05T03:00:00Z",
      changes: {
        fields: [
          {
            field: "superAdmin",
            from: false,
            to: true,
            label: "Manages the whitelist",
          },
        ],
      },
    });
  });

  it("hides admin_whitelist events from a non-holder, keeping drivers and vans", async () => {
    const { entries } = await list({}, { includeAdminTargets: false });
    expect(entries.map((e) => e.target).sort()).toEqual(["drivers", "vans"]);
    // Not just the target column: the leak was the payload, not the label.
    expect(JSON.stringify(entries)).not.toContain("Manages the whitelist");
  });

  it("shows all three to a holder", async () => {
    const { entries } = await list({}, { includeAdminTargets: true });
    expect(entries.map((e) => e.target).sort()).toEqual([
      "admin_whitelist",
      "drivers",
      "vans",
    ]);
  });

  // A non-holder's page must not be padded from the hidden rows either: the
  // exclusion belongs in the query, not in a post-filter over the page.
  it("does not leak an admin event through a non-holder's pagination", async () => {
    const { entries, nextCursor } = await list(
      { limit: 2 },
      { includeAdminTargets: false },
    );
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.target !== "admin_whitelist")).toBe(true);
    expect(nextCursor).toBeNull();
  });
});
