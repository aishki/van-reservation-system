import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { ROSTER_EVENT_TYPES, ROSTER_TARGETS } from "@/modules/roster/types";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

/** Marks this suite's rows so cleanup cannot touch another's. */
const ACTOR = "roster-constraints-int";

// Cleanup lives here, not inline at the end of each it(), so a failed
// expect() still lets the row get deleted — an inline delete after the
// assertion never runs when the assertion throws, and a leaked row breaks
// a later suite in this shared, non-parallel integration database.
afterEach(async () => {
  await sql`delete from roster_events where actor_name = ${ACTOR}`.execute(db);
  await sql`delete from admin_whitelist where full_name = ${ACTOR}`.execute(db);
});

/**
 * The live CHECK's vocabulary, read out of the schema.
 *
 * Copied from `schema-constraints.int.test.ts`, which is the house pattern for
 * a TypeScript union the database mirrors: read the constraint back and diff it
 * against the union in BOTH directions. This file used to hand-copy both
 * vocabularies as literals, so adding a fifth `ROSTER_EVENT_TYPES` member would
 * have left every test green while Postgres rejected the insert at runtime —
 * the same shape as the writer/reader disagreement four self-consistent tests
 * missed late in this branch.
 */
async function checkedValues(conname: string): Promise<Set<string>> {
  const result = await sql<{
    def: string;
  }>`select pg_get_constraintdef(oid) as def from pg_constraint where conname = ${conname}`.execute(
    db,
  );
  const def = result.rows[0]?.def;
  if (def === undefined) {
    throw new Error(`Constraint "${conname}" was not found in the schema`);
  }
  // Postgres renders `x in (...)` back as `x = ANY (ARRAY['a'::text, ...]))`.
  // Every literal in that array is `'<value>'::text`.
  const matches = def.matchAll(/'([^']*)'::text/g);
  return new Set(Array.from(matches, (m) => m[1]));
}

const event = (overrides: Record<string, unknown> = {}) => ({
  target_table: "drivers",
  target_id: "00000000-0000-0000-0000-000000000001",
  event_type: "created",
  actor_name: ACTOR,
  actor_role: "admin_support",
  ...overrides,
});

async function insert(values: Record<string, unknown>): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: deliberately writing an out-of-vocabulary value to prove the CHECK rejects it.
  const row = values as any;
  await db.insertInto("roster_events").values(row).execute();
}

describe("roster_events CHECK constraints match the roster vocabulary", () => {
  it("target_table admits exactly ROSTER_TARGETS, neither more nor fewer", async () => {
    expect(await checkedValues("roster_events_target_table_check")).toEqual(
      new Set(ROSTER_TARGETS),
    );
  });

  it("event_type admits exactly ROSTER_EVENT_TYPES, neither more nor fewer", async () => {
    expect(await checkedValues("roster_events_event_type_check")).toEqual(
      new Set(ROSTER_EVENT_TYPES),
    );
  });
});

describe("roster_events constraints", () => {
  // Driven off the runtime array, not a literal list: a member added to
  // `ROSTER_TARGETS` is inserted here too, so a missed migration fails.
  it("accepts every target_table in the vocabulary", async () => {
    for (const table of ROSTER_TARGETS) {
      await expect(
        insert(event({ target_table: table })),
      ).resolves.toBeUndefined();
    }
  });

  it("rejects a target_table outside the vocabulary", async () => {
    await expect(
      insert(event({ target_table: "reservations" })),
    ).rejects.toThrow(/roster_events_target_table_check/);
  });

  it("accepts every event_type in the vocabulary", async () => {
    for (const type of ROSTER_EVENT_TYPES) {
      await expect(
        insert(event({ event_type: type })),
      ).resolves.toBeUndefined();
    }
  });

  it("rejects an event_type outside the vocabulary", async () => {
    await expect(insert(event({ event_type: "deleted" }))).rejects.toThrow(
      /roster_events_event_type_check/,
    );
  });

  it("requires an actor — a roster change is never a system event", async () => {
    await expect(insert(event({ actor_name: null }))).rejects.toThrow(
      /actor_name/,
    );
  });

  it("rejects an actor_role outside the app's roles", async () => {
    await expect(insert(event({ actor_role: "driver" }))).rejects.toThrow(
      /roster_events_actor_role_check/,
    );
  });
});

describe("admin_whitelist.super_admin", () => {
  it("defaults to false, so adding the column privileges nobody", async () => {
    const row = await db
      .insertInto("admin_whitelist")
      .values({
        full_name: ACTOR,
        email: `${ACTOR}@x.invalid`,
        domain_id: null,
        site: "all",
      })
      .returning("super_admin")
      .executeTakeFirstOrThrow();

    expect(row.super_admin).toBe(false);
  });
});
