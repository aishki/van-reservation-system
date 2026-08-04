import { afterAll, describe, expect, it } from "vitest";
import { testDb, withRollback } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("users constraints", () => {
  it("accepts a valid associate", async () => {
    await withRollback(db, async (trx) => {
      const row = await trx
        .insertInto("users")
        .values({
          domain_id: "AB12345",
          name: "Juan Dela Cruz",
          email: "juan.delacruz@carelon.com",
          role: "associate",
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      expect(row.id).toBeTruthy();
      expect(row.created_at).toBeInstanceOf(Date);
    });
  });

  it("rejects an unknown role", async () => {
    await withRollback(db, async (trx) => {
      await expect(
        trx
          .insertInto("users")
          .values({
            domain_id: "AB12346",
            name: "Nope",
            email: "nope@carelon.com",
            role: "superuser",
          })
          .execute(),
      ).rejects.toThrow(/users_role_check/);
    });
  });

  it("rejects a duplicate domain_id", async () => {
    await withRollback(db, async (trx) => {
      const base = {
        name: "Dup",
        email: "dup@carelon.com",
        role: "associate" as const,
      };
      await trx
        .insertInto("users")
        .values({ ...base, domain_id: "DUP001" })
        .execute();
      await expect(
        trx
          .insertInto("users")
          .values({ ...base, domain_id: "DUP001" })
          .execute(),
      ).rejects.toThrow();
    });
  });
});

describe("admin_whitelist constraints", () => {
  it("rejects an entry with neither email nor domain_id", async () => {
    await withRollback(db, async (trx) => {
      await expect(
        trx
          .insertInto("admin_whitelist")
          .values({ full_name: "Ghost", site: "iloilo" })
          .execute(),
      ).rejects.toThrow(/admin_whitelist_identity_check/);
    });
  });

  it("rejects an unknown site", async () => {
    await withRollback(db, async (trx) => {
      await expect(
        trx
          .insertInto("admin_whitelist")
          .values({
            full_name: "Wrong Site",
            email: "ws@carelon.com",
            site: "cebu",
          })
          .execute(),
      ).rejects.toThrow(/admin_whitelist_site_check/);
    });
  });

  it("treats whitelist emails as case-insensitive", async () => {
    await withRollback(db, async (trx) => {
      await trx
        .insertInto("admin_whitelist")
        .values({
          full_name: "Ivy Balandra",
          email: "Ivy.Balandra@carelon.com",
          site: "iloilo",
        })
        .execute();
      await expect(
        trx
          .insertInto("admin_whitelist")
          .values({
            full_name: "Ivy Again",
            email: "ivy.balandra@carelon.com",
            site: "iloilo",
          })
          .execute(),
      ).rejects.toThrow(/admin_whitelist_email_lower_trim_idx/);
    });
  });
});
