import type { Transaction } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { ADMIN_WHITELIST_SEED } from "@/modules/auth/admin-whitelist-seed";
import { seed } from "@/modules/db/seeds/20260804000000_admin_whitelist";
import type { DB } from "@/modules/db/types";
import { testDb, withRollback } from "../../../test/with-rollback";

// Not colocated with the migrations/ or seeds/ directories: kysely-ctl's
// FileMigrationProvider/FileSeedProvider load every file in those folders and
// would try to run this test as a migration or seed.

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("admin_whitelist seed runner", () => {
  it("is idempotent: seeding twice yields exactly eight rows, no duplicates", async () => {
    await withRollback(db, async (trx) => {
      await seed(trx);
      const first = await trx
        .selectFrom("admin_whitelist")
        .selectAll()
        .execute();
      expect(first).toHaveLength(ADMIN_WHITELIST_SEED.length);

      await seed(trx);
      const second = await trx
        .selectFrom("admin_whitelist")
        .selectAll()
        .execute();
      expect(second).toHaveLength(ADMIN_WHITELIST_SEED.length);
    });
  });

  it("corrects drift: re-seeding overwrites a manually changed site back to the seed value", async () => {
    await withRollback(db, async (trx) => {
      await seed(trx);

      const target = ADMIN_WHITELIST_SEED[0];
      if (!target) throw new Error("ADMIN_WHITELIST_SEED is empty");
      const driftedSite = target.site === "manila" ? "iloilo" : "manila";

      await trx
        .updateTable("admin_whitelist")
        .set({ site: driftedSite })
        .where("email", "=", target.email)
        .execute();

      await seed(trx);

      const row = await trx
        .selectFrom("admin_whitelist")
        .select("site")
        .where("email", "=", target.email)
        .executeTakeFirstOrThrow();

      expect(row.site).toBe(target.site);
    });
  });

  it("deactivates a row that has left the seed list", async () => {
    await withRollback(db, async (trx) => {
      await trx
        .insertInto("admin_whitelist")
        .values({
          full_name: "Departed Admin",
          email: "departed.admin@example.invalid",
          domain_id: "ZZ88888",
          site: "iloilo",
        })
        .execute();

      await seed(trx);

      const departed = await trx
        .selectFrom("admin_whitelist")
        .select(["active"])
        .where("email", "=", "departed.admin@example.invalid")
        .executeTakeFirstOrThrow();
      // Left in place as a record, but switched off: an unreachable address in
      // a Cc makes SES reject the entire message.
      expect(departed.active).toBe(false);

      const live = await trx
        .selectFrom("admin_whitelist")
        .select(["email"])
        .where("active", "=", true)
        .execute();
      expect(live).toHaveLength(ADMIN_WHITELIST_SEED.length);
    });
  });

  it("leaves every seeded admin active when nothing has departed", async () => {
    await withRollback(db, async (trx) => {
      await seed(trx);
      await seed(trx);
      const live = await trx
        .selectFrom("admin_whitelist")
        .select(["email"])
        .where("active", "=", true)
        .execute();
      expect(live).toHaveLength(ADMIN_WHITELIST_SEED.length);
    });
  });
});

/**
 * A `/roster` write, as the seed sees it: a `roster_events` row is the only
 * thing that distinguishes a person's decision from this seed's own writes.
 */
async function rosterEvent(
  trx: Transaction<DB>,
  targetId: string,
  eventType: "created" | "deactivated" | "reactivated",
): Promise<void> {
  await trx
    .insertInto("roster_events")
    .values({
      target_table: "admin_whitelist",
      target_id: targetId,
      event_type: eventType,
      actor_name: "Jimera, Arielle",
      actor_role: "admin_support",
    })
    .execute();
}

/**
 * The seed stopped being this table's only writer when `/roster` shipped. The
 * comment that used to sit on `deactivateDeparted` predicted exactly this.
 */
describe("admin_whitelist seed runner vs the /roster UI", () => {
  it("leaves an admin ADDED through /roster active, though the seed list omits them", async () => {
    await withRollback(db, async (trx) => {
      const added = await trx
        .insertInto("admin_whitelist")
        .values({
          full_name: "Hand Added Admin",
          email: "hand.added@example.invalid",
          domain_id: "ZZ77777",
          site: "iloilo",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await rosterEvent(trx, added.id, "created");

      await seed(trx);

      const row = await trx
        .selectFrom("admin_whitelist")
        .select("active")
        .where("id", "=", added.id)
        .executeTakeFirstOrThrow();
      expect(row.active).toBe(true);
    });
  });

  it("leaves a seeded admin RETIRED through /roster deactivated", async () => {
    await withRollback(db, async (trx) => {
      await seed(trx);

      const target = ADMIN_WHITELIST_SEED[0];
      if (!target) throw new Error("ADMIN_WHITELIST_SEED is empty");
      const row = await trx
        .selectFrom("admin_whitelist")
        .select("id")
        .where("email", "=", target.email)
        .executeTakeFirstOrThrow();

      await trx
        .updateTable("admin_whitelist")
        .set({ active: false })
        .where("id", "=", row.id)
        .execute();
      await rosterEvent(trx, row.id, "deactivated");

      await seed(trx);

      const after = await trx
        .selectFrom("admin_whitelist")
        .select("active")
        .where("id", "=", row.id)
        .executeTakeFirstOrThrow();
      expect(after.active).toBe(false);
    });
  });

  // The 23505 this used to die on: the conflict target was `lower(trim(email))`
  // alone, so an address edited through `/roster` made the seed INSERT and
  // collide on `admin_whitelist_domain_id_idx`.
  it("converges an admin whose email was edited through /roster, without a duplicate", async () => {
    await withRollback(db, async (trx) => {
      await seed(trx);

      const target = ADMIN_WHITELIST_SEED.find((row) => row.domain_id !== null);
      if (!target) throw new Error("no seed row carries a Domain ID");

      await trx
        .updateTable("admin_whitelist")
        .set({ email: "edited.by.hand@example.invalid" })
        .where("domain_id", "=", target.domain_id)
        .execute();

      await expect(seed(trx)).resolves.toBeUndefined();

      const rows = await trx
        .selectFrom("admin_whitelist")
        .select(["email", "active"])
        .where("domain_id", "=", target.domain_id)
        .execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.email).toBe(target.email);
      expect(rows[0]?.active).toBe(true);
    });
  });

  // The email fallback in `findSeedRow`. Every seed entry carries a Domain ID
  // today, so the only way to reach that branch is a STORED row that predates
  // one — the shape an older deploy left behind. The fallback is what fills the
  // Domain ID in, and without it the seed would insert a duplicate person.
  it("matches a stored row that has no Domain ID by email, and fills the Domain ID in", async () => {
    await withRollback(db, async (trx) => {
      const target = ADMIN_WHITELIST_SEED.find((row) => row.domain_id !== null);
      if (!target) throw new Error("no seed row carries a Domain ID");

      const legacy = await trx
        .insertInto("admin_whitelist")
        .values({
          full_name: "Legacy Row",
          email: target.email,
          domain_id: null,
          site: "iloilo",
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      await seed(trx);

      const row = await trx
        .selectFrom("admin_whitelist")
        .select(["id", "domain_id", "full_name", "active"])
        .where("email", "=", target.email)
        .executeTakeFirstOrThrow();
      // The SAME row, not a second one: matched by email, then converged.
      expect(row.id).toBe(legacy.id);
      expect(row.domain_id).toBe(target.domain_id);
      expect(row.full_name).toBe(target.full_name);
      expect(row.active).toBe(true);
    });
  });

  /**
   * The direction `humanManagedIds` used to miss. The seed retires a departed
   * admin WITHOUT writing an event — it owns that row — so a holder clicking
   * Reactivate leaves only a `reactivated` event behind.
   *
   * The event is inserted rather than written through `setAdminActive`: that
   * opens its own `db.transaction()`, which Kysely refuses inside the rollback
   * transaction this suite runs in. `repo.int.test.ts` pins the other half —
   * that `setAdminActive(..., true)` really does write `reactivated` — so the
   * writer and this reader cannot drift apart unnoticed.
   */
  it("leaves a seed-retired admin REACTIVATED through /roster active", async () => {
    await withRollback(db, async (trx) => {
      const departed = await trx
        .insertInto("admin_whitelist")
        .values({
          full_name: "Departed Then Restored",
          email: "departed.restored@example.invalid",
          domain_id: "ZZ66666",
          site: "iloilo",
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      // Run one: the seed retires them, silently and correctly.
      await seed(trx);
      const retired = await trx
        .selectFrom("admin_whitelist")
        .select("active")
        .where("id", "=", departed.id)
        .executeTakeFirstOrThrow();
      expect(retired.active).toBe(false);

      await trx
        .updateTable("admin_whitelist")
        .set({ active: true })
        .where("id", "=", departed.id)
        .execute();
      await rosterEvent(trx, departed.id, "reactivated");

      // Run two, the next deploy. Before `reactivated` joined the list this
      // switched them straight back off, every time.
      await seed(trx);

      const after = await trx
        .selectFrom("admin_whitelist")
        .select("active")
        .where("id", "=", departed.id)
        .executeTakeFirstOrThrow();
      expect(after.active).toBe(true);
    });
  });
});
