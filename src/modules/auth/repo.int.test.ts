import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { listActiveWhitelist, upsertUser } from "@/modules/auth/repo";
import { testDb, withRollback } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const identity = {
  domainId: "AB12345",
  name: "Juan Dela Cruz",
  email: "juan.delacruz@carelon.com",
  contactNumber: "09171234567",
};

describe("upsertUser", () => {
  it("creates the local record on first login (FR-4)", async () => {
    await withRollback(db, async (trx) => {
      const user = await upsertUser(trx, identity, "associate");
      expect(user.domain_id).toBe("AB12345");
      expect(user.role).toBe("associate");
      expect(user.mobile_number).toBe("09171234567");
      expect(user.last_login_at).toBeInstanceOf(Date);
    });
  });

  it("refreshes the profile on later logins without duplicating (FR-3)", async () => {
    await withRollback(db, async (trx) => {
      const first = await upsertUser(trx, identity, "associate");
      const second = await upsertUser(
        trx,
        { ...identity, name: "Juan D. Cruz", contactNumber: "09980000000" },
        "associate",
      );

      expect(second.id).toBe(first.id);
      expect(second.name).toBe("Juan D. Cruz");
      expect(second.mobile_number).toBe("09980000000");

      const count = await trx
        .selectFrom("users")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("domain_id", "=", "AB12345")
        .executeTakeFirstOrThrow();
      expect(Number(count.n)).toBe(1);
    });
  });

  it("re-applies the role on every login (FR-5)", async () => {
    await withRollback(db, async (trx) => {
      await upsertUser(trx, identity, "associate");
      const promoted = await upsertUser(trx, identity, "admin_support");
      expect(promoted.role).toBe("admin_support");

      const demoted = await upsertUser(trx, identity, "associate");
      expect(demoted.role).toBe("associate");
    });
  });

  it("advances updated_at and last_login_at on a later login rather than leaving stale values", async () => {
    await withRollback(db, async (trx) => {
      const first = await upsertUser(trx, identity, "associate");

      // users.updated_at has no ON UPDATE trigger, so backdate both columns
      // to a point clearly before "now()" and prove the second upsert's
      // doUpdateSet actually overwrites them rather than the DEFAULT quietly
      // doing nothing. now() is pinned to transaction start, so both upserts
      // in this single transaction would otherwise appear to produce the same
      // timestamp even if the write worked — backdating sidesteps that.
      const backdated = await trx
        .updateTable("users")
        .set({
          updated_at: sql`now() - interval '1 day'`,
          last_login_at: sql`now() - interval '1 day'`,
        })
        .where("id", "=", first.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      const second = await upsertUser(trx, identity, "associate");

      expect(second.updated_at.getTime()).toBeGreaterThan(
        backdated.updated_at.getTime(),
      );
      expect(second.last_login_at).not.toBeNull();
      expect(second.last_login_at?.getTime()).toBeGreaterThan(
        backdated.last_login_at?.getTime() ?? 0,
      );
    });
  });

  it("stores a null mobile number when the provider omits it", async () => {
    await withRollback(db, async (trx) => {
      const user = await upsertUser(
        trx,
        {
          domainId: "CD67890",
          name: "No Phone",
          email: "no.phone@carelon.com",
        },
        "associate",
      );
      expect(user.mobile_number).toBeNull();
    });
  });
});

describe("listActiveWhitelist", () => {
  it("returns only active entries", async () => {
    await withRollback(db, async (trx) => {
      await trx
        .insertInto("admin_whitelist")
        .values([
          { full_name: "Active One", email: "a1@carelon.com", site: "iloilo" },
          {
            full_name: "Inactive One",
            email: "i1@carelon.com",
            site: "manila",
            active: false,
          },
        ])
        .execute();

      const entries = await listActiveWhitelist(trx);
      const emails = entries.map((e) => e.email);
      expect(emails).toContain("a1@carelon.com");
      expect(emails).not.toContain("i1@carelon.com");
    });
  });
});
