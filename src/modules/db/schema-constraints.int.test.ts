import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { ADMIN_SITES, APP_ROLES } from "@/modules/auth/roles";
import {
  DB_RESERVATION_STATUSES,
  DB_SITE_LOCATIONS,
  RESERVATION_EVENT_TYPES,
} from "@/modules/reservations/db-map";
import { RIDE_MODES } from "@/modules/reservations/types";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

/**
 * APP_ROLES and ADMIN_SITES are hand-written TypeScript unions; the database
 * enforces the same vocabulary via CHECK constraints on `users.role` and
 * `admin_whitelist.site`, and nothing keeps the two in sync. Slice 2 repeats
 * this shape for the reservation `status` enum, where drift would silently
 * break the "approved, never assigned" constraint — so this pins the pattern
 * here: read the live constraint text and diff it against the union in both
 * directions, not just "the union's values are all legal".
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
  // Postgres renders `role in (...)` back as `role = ANY (ARRAY['a'::text, ...]))`.
  // Every literal in that array is `'<value>'::text`.
  const matches = def.matchAll(/'([^']*)'::text/g);
  return new Set(Array.from(matches, (m) => m[1]));
}

describe("users.role CHECK constraint matches APP_ROLES", () => {
  it("admits exactly the roles in APP_ROLES, neither more nor fewer", async () => {
    const dbValues = await checkedValues("users_role_check");
    expect(dbValues).toEqual(new Set(APP_ROLES));
  });
});

describe("admin_whitelist.site CHECK constraint matches ADMIN_SITES", () => {
  it("admits exactly the sites in ADMIN_SITES, neither more nor fewer", async () => {
    const dbValues = await checkedValues("admin_whitelist_site_check");
    expect(dbValues).toEqual(new Set(ADMIN_SITES));
  });
});

describe("reservations CHECK constraints match the db-map vocabulary", () => {
  it("status", async () => {
    expect(await checkedValues("reservations_status_check")).toEqual(
      new Set(DB_RESERVATION_STATUSES),
    );
  });

  it("ride_mode", async () => {
    expect(await checkedValues("reservations_ride_mode_check")).toEqual(
      new Set(RIDE_MODES),
    );
  });

  it("site", async () => {
    expect(await checkedValues("reservations_site_check")).toEqual(
      new Set(DB_SITE_LOCATIONS),
    );
  });

  it("event_type", async () => {
    expect(await checkedValues("reservation_events_event_type_check")).toEqual(
      new Set(RESERVATION_EVENT_TYPES),
    );
  });
});

describe("drivers CHECK constraints match the db-map vocabulary", () => {
  it("site", async () => {
    expect(await checkedValues("drivers_site_check")).toEqual(
      new Set(DB_SITE_LOCATIONS),
    );
  });

  // `shift` has no constraint to pin: it is free text now. The real roster has
  // no shift for Iloilo and "11AM-11PM" for Manila, and Phase 2 makes it
  // editable, so a closed vocabulary would cost a migration per revision.
  // Scans `pg_constraint` for any CHECK on `drivers` mentioning `shift`, not
  // just the old `drivers_shift_check` name, so a re-added vocabulary under a
  // different name still fails this.
  it("shift is unconstrained free text, nullable", async () => {
    const result = await sql<{
      is_nullable: string;
    }>`select is_nullable from information_schema.columns
         where table_name = 'drivers' and column_name = 'shift'`.execute(db);
    expect(result.rows[0]?.is_nullable).toBe("YES");
    const constraints = await sql<{
      def: string;
    }>`select pg_get_constraintdef(oid) as def from pg_constraint
         where conrelid = 'drivers'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%shift%'`.execute(db);
    expect(constraints.rows).toEqual([]);
  });
});

describe("vans", () => {
  const ids: string[] = [];

  afterAll(async () => {
    // Row-leak gate: this suite shares one database with every other
    // *.int.test.ts and fileParallelism is false.
    if (ids.length > 0) {
      await db.deleteFrom("vans").where("id", "in", ids).execute();
    }
  });

  it("accepts a well-formed van", async () => {
    const row = await db
      .insertInto("vans")
      .values({
        van_number: "VAN-901",
        plate: "TEST 9001",
        car_type: "Toyota GL",
        site: "iloilo",
      })
      .returning(["id", "active"])
      .executeTakeFirstOrThrow();
    ids.push(row.id);
    expect(row.active).toBe(true);
  });

  it("rejects a duplicate plate", async () => {
    const first = await db
      .insertInto("vans")
      .values({
        van_number: "VAN-902",
        plate: "TEST 9002",
        car_type: "Nissan Urvan 350",
        site: "manila",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    ids.push(first.id);

    await expect(
      db
        .insertInto("vans")
        .values({
          van_number: "VAN-903",
          plate: "TEST 9002",
          car_type: "Toyota GL",
          site: "manila",
        })
        .execute(),
    ).rejects.toThrow(/vans_plate_key|unique/i);
  });

  it("rejects a duplicate van number", async () => {
    const first = await db
      .insertInto("vans")
      .values({
        van_number: "VAN-904",
        plate: "TEST 9004",
        car_type: "Toyota GL",
        site: "manila",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    ids.push(first.id);

    await expect(
      db
        .insertInto("vans")
        .values({
          van_number: "VAN-904",
          plate: "TEST 9005",
          car_type: "Toyota GL",
          site: "manila",
        })
        .execute(),
    ).rejects.toThrow(/vans_van_number_key|unique/i);
  });

  it("rejects an unknown site", async () => {
    await expect(
      db
        .insertInto("vans")
        .values({
          van_number: "VAN-905",
          plate: "TEST 9006",
          car_type: "Toyota GL",
          site: "cebu",
        })
        .execute(),
    ).rejects.toThrow(/vans_site_check/);
  });
});
