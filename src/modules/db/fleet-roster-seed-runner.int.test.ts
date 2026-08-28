import { afterAll, describe, expect, it } from "vitest";
import { seed } from "@/modules/db/seeds/20260827000000_fleet_roster";
import { testDb, withRollback } from "../../../test/with-rollback";

// Not colocated with the seeds/ directory: kysely-ctl's FileSeedProvider
// loads every file in that folder and would try to run this test as a seed.

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("fleet_roster seed runner", () => {
  it("is idempotent: seeding twice yields exactly 4 vans and 8 drivers, no duplicates", async () => {
    await withRollback(db, async (trx) => {
      await seed(trx);
      await seed(trx);

      const vans = await trx.selectFrom("vans").selectAll().execute();
      expect(vans).toHaveLength(4);

      const drivers = await trx.selectFrom("drivers").selectAll().execute();
      expect(drivers).toHaveLength(8);
    });
  });

  it("VAN-003 carries the real plate and car type", async () => {
    await withRollback(db, async (trx) => {
      await seed(trx);

      const van = await trx
        .selectFrom("vans")
        .selectAll()
        .where("van_number", "=", "VAN-003")
        .executeTakeFirstOrThrow();
      expect(van.plate).toBe("NHU 8001");
      expect(van.car_type).toBe("Hi Ace Super Grandia");
    });
  });

  it("Ronald Japitana's shift is null; Ian Aduana's is 11AM-11PM", async () => {
    await withRollback(db, async (trx) => {
      await seed(trx);

      const ronald = await trx
        .selectFrom("drivers")
        .selectAll()
        .where("name", "=", "Ronald Japitana")
        .executeTakeFirstOrThrow();
      expect(ronald.shift).toBeNull();

      const ian = await trx
        .selectFrom("drivers")
        .selectAll()
        .where("name", "=", "Ian Aduana")
        .executeTakeFirstOrThrow();
      expect(ian.shift).toBe("11AM-11PM");
    });
  });

  // `/roster` gives every Admin Support member a retire button. Both branches
  // of this seed used to force `active` back to true on every run, which would
  // quietly put a retired van back in the assignment dropdown after a deploy.
  it("does not resurrect a van or driver retired through /roster", async () => {
    await withRollback(db, async (trx) => {
      await seed(trx);

      await trx
        .updateTable("vans")
        .set({ active: false })
        .where("van_number", "=", "VAN-001")
        .execute();
      await trx
        .updateTable("drivers")
        .set({ active: false })
        .where("name", "=", "Paul Zonio")
        .execute();

      await seed(trx);

      const van = await trx
        .selectFrom("vans")
        .select("active")
        .where("van_number", "=", "VAN-001")
        .executeTakeFirstOrThrow();
      const driver = await trx
        .selectFrom("drivers")
        .select("active")
        .where("name", "=", "Paul Zonio")
        .executeTakeFirstOrThrow();

      expect(van.active).toBe(false);
      expect(driver.active).toBe(false);
    });
  });

  // The seeded FIELDS are still corrected on every run — only `active` is
  // left alone.
  it("still corrects a drifted plate on a retired van", async () => {
    await withRollback(db, async (trx) => {
      await seed(trx);
      await trx
        .updateTable("vans")
        .set({ active: false, plate: "WRONG 0000" })
        .where("van_number", "=", "VAN-002")
        .execute();

      await seed(trx);

      const van = await trx
        .selectFrom("vans")
        .select(["plate", "active"])
        .where("van_number", "=", "VAN-002")
        .executeTakeFirstOrThrow();
      expect(van.plate).toBe("FAR 7820");
      expect(van.active).toBe(false);
    });
  });
});
