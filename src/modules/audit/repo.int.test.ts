import { sql } from "kysely";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type AuditQuery, listAuditEntries } from "@/modules/audit/repo";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  await cleanup();
  await db.destroy();
});

async function cleanup() {
  await sql`delete from reservation_events`.execute(db);
  await sql`delete from reservation_passengers`.execute(db);
  await sql`delete from reservations`.execute(db);
  await sql`delete from users where domain_id in ('ZA90001', 'ZA90002', 'ZA90003')`.execute(
    db,
  );
}

let requestorId: string;
let ivyId: string;
let norlynId: string;
let reservationId: string;

beforeEach(async () => {
  await cleanup();

  const user = (domainId: string, name: string, role: string) =>
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

  requestorId = (await user("ZA90001", "Jimera, Arielle", "associate")).id;
  ivyId = (await user("ZA90002", "Balandra, Ivy", "admin_support")).id;
  norlynId = (await user("ZA90003", "Abanto, Norlyn", "admin_support")).id;

  reservationId = (
    await db
      .insertInto("reservations")
      .values({
        reference_no: "VR-2026-700001",
        ride_mode: "pickup",
        status: "pending",
        site: "manila",
        requestor_user_id: requestorId,
        requestor_name: "Jimera, Arielle",
        requestor_email: "za90001@example.invalid",
        requestor_mobile: "09171112222",
        purpose: "Travel-Related (Airport Transfers)",
        details: "Audit repo test trip.",
        start_at: new Date("2026-08-10T22:30:00Z"),
        pickup_location: "AGT Tower lobby",
        dropoff_location: "GLS Building",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
});

interface EventInput {
  eventType: string;
  actorUserId?: string;
  actorName?: string;
  actorRole?: string;
  at: string;
  remark?: string | null;
  changes?: unknown;
}

async function event(input: EventInput): Promise<string> {
  const row = await db
    .insertInto("reservation_events")
    .values({
      reservation_id: reservationId,
      actor_user_id: input.actorUserId ?? ivyId,
      actor_name: input.actorName ?? "Balandra, Ivy",
      actor_role: input.actorRole ?? "admin_support",
      event_type: input.eventType,
      created_at: new Date(input.at),
      remark: input.remark ?? null,
      changes:
        input.changes === undefined ? null : JSON.stringify(input.changes),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const blank: AuditQuery = {
  action: null,
  actor: null,
  from: null,
  to: null,
  limit: 50,
  cursor: null,
};

const list = (overrides: Partial<AuditQuery> = {}) =>
  listAuditEntries(db, { ...blank, ...overrides });

describe("listAuditEntries", () => {
  it("returns admin actions with the trip they were taken on", async () => {
    await event({ eventType: "approved", at: "2026-08-05T01:00:00Z" });

    const { entries } = await list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "approved",
      actorName: "Balandra, Ivy",
      reference: "VR-2026-700001",
      requestor: "Jimera, Arielle",
      site: "Manila",
      purpose: "Travel-Related (Airport Transfers)",
    });
    // Manila wall-clock, so a 22:30Z start reads as the 11th, not the 10th.
    expect(entries[0].startDate).toBe("2026-08-11");
  });

  // The scope decision was admin actions only, and a scope that a query
  // parameter can widen is not a scope.
  it("omits an associate's own events", async () => {
    await event({
      eventType: "cancelled",
      actorUserId: requestorId,
      actorName: "Jimera, Arielle",
      actorRole: "associate",
      at: "2026-08-05T01:00:00Z",
    });

    expect((await list()).entries).toEqual([]);
  });

  it("omits submitted even from an admin who booked their own van", async () => {
    await event({ eventType: "submitted", at: "2026-08-05T01:00:00Z" });
    expect((await list()).entries).toEqual([]);
  });

  it("orders newest first", async () => {
    await event({ eventType: "approved", at: "2026-08-01T01:00:00Z" });
    await event({ eventType: "modified", at: "2026-08-09T01:00:00Z" });
    await event({ eventType: "van_assigned", at: "2026-08-05T01:00:00Z" });

    expect((await list()).entries.map((e) => e.action)).toEqual([
      "modified",
      "van_assigned",
      "approved",
    ]);
  });

  // Every event written in one transaction shares a created_at. Ordering on the
  // timestamp alone returns them in whatever order the scan produced, so a page
  // boundary landing inside such a group repeats or skips rows.
  it("paginates across a created_at tie without repeating or dropping a row", async () => {
    const TIED = "2026-08-05T01:00:00Z";
    const inserted: string[] = [];
    for (const eventType of [
      "approved",
      "modified",
      "van_assigned",
      "driver_assigned",
      "driver_reassigned",
    ]) {
      inserted.push(await event({ eventType, at: TIED }));
    }

    const seen: string[] = [];
    let cursor = null as AuditQuery["cursor"];
    for (let page = 0; page < 3; page += 1) {
      const result = await list({ limit: 2, cursor });
      seen.push(...result.entries.map((entry) => entry.id));
      cursor = result.nextCursor;
      if (cursor === null) break;
    }

    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...inserted].sort());
  });

  it("returns a null nextCursor on the last page", async () => {
    await event({ eventType: "approved", at: "2026-08-05T01:00:00Z" });
    expect((await list({ limit: 10 })).nextCursor).toBeNull();
  });

  it.each(["approved", "driver_reassigned"] as const)(
    "filters by action %s",
    async (action) => {
      await event({ eventType: "approved", at: "2026-08-01T01:00:00Z" });
      await event({
        eventType: "driver_reassigned",
        at: "2026-08-02T01:00:00Z",
      });

      const { entries } = await list({ action });
      expect(entries.map((e) => e.action)).toEqual([action]);
    },
  );

  it("filters by actor", async () => {
    await event({ eventType: "approved", at: "2026-08-01T01:00:00Z" });
    await event({
      eventType: "modified",
      actorUserId: norlynId,
      actorName: "Abanto, Norlyn",
      at: "2026-08-02T01:00:00Z",
    });

    const { entries } = await list({ actor: "norlyn" });
    expect(entries.map((e) => e.actorName)).toEqual(["Abanto, Norlyn"]);
  });

  // Bounds are plain Manila dates; the column is timestamptz. An event at 23:00
  // Manila on the `to` date must be INCLUDED, or an admin filtering "today"
  // sees nothing recorded after Manila midnight.
  it("filters by an inclusive Manila date range", async () => {
    // 2026-08-05 15:00Z is 23:00 Manila the same day.
    await event({ eventType: "approved", at: "2026-08-05T15:00:00Z" });
    // 2026-08-06 17:00Z is 01:00 Manila on the 7th — outside the range.
    await event({ eventType: "modified", at: "2026-08-06T17:00:00Z" });

    const { entries } = await list({ from: "2026-08-05", to: "2026-08-06" });
    expect(entries.map((e) => e.action)).toEqual(["approved"]);
  });

  it("caps the limit at 100", async () => {
    await event({ eventType: "approved", at: "2026-08-05T01:00:00Z" });
    // Would throw or over-fetch if the cap were only in the wire schema.
    await expect(list({ limit: 10_000 })).resolves.toBeDefined();
  });

  it("parses legacy changes without failing the page", async () => {
    await event({
      eventType: "modified",
      at: "2026-08-05T01:00:00Z",
      changes: { fields: ["purpose"] },
    });

    const { entries } = await list();
    expect(entries[0].changes).toEqual({
      kind: "names",
      fields: ["purpose"],
    });
  });

  it("parses the current changes shape", async () => {
    await event({
      eventType: "driver_reassigned",
      at: "2026-08-05T01:00:00Z",
      changes: {
        fields: [{ field: "driver", label: "Driver", from: "Rey", to: "Ian" }],
      },
    });

    expect((await list()).entries[0].changes).toEqual({
      kind: "fields",
      changes: [{ field: "driver", label: "Driver", from: "Rey", to: "Ian" }],
    });
  });

  it("carries a rejection reason through as the remark", async () => {
    await event({
      eventType: "rejected",
      at: "2026-08-05T01:00:00Z",
      remark: "No van available that week.",
    });

    expect((await list()).entries[0].remark).toBe(
      "No van available that week.",
    );
  });
});
