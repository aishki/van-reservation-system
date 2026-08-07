import { sql } from "kysely";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { upsertUser } from "@/modules/auth/repo";
import { testDb } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  await sql`delete from users where domain_id in ('ZZ90001', 'ZZ90002')`.execute(
    db,
  );
  await sql`delete from admin_whitelist where email in (' zz@example.invalid', 'zz@example.invalid')`.execute(
    db,
  );
  await db.destroy();
});

beforeEach(async () => {
  await sql`delete from users where domain_id in ('ZZ90001', 'ZZ90002')`.execute(
    db,
  );
  await sql`delete from admin_whitelist where email in (' zz@example.invalid', 'zz@example.invalid')`.execute(
    db,
  );
});

describe("users domain_id case-insensitive uniqueness", () => {
  it("refuses a case-twin of an existing domain_id", async () => {
    await db
      .insertInto("users")
      .values({
        domain_id: "ZZ90001",
        name: "Test One",
        email: "one@example.invalid",
        role: "associate",
      })
      .execute();

    await expect(
      db
        .insertInto("users")
        .values({
          domain_id: "zz90001",
          name: "Test Two",
          email: "two@example.invalid",
          role: "associate",
        })
        .execute(),
    ).rejects.toThrow(/users_domain_id_lower_idx/);
  });

  it("upsertUser stores the domain_id upper-cased", async () => {
    const user = await upsertUser(
      db,
      {
        domainId: "zz90002",
        name: "Test Three",
        email: "three@example.invalid",
      },
      "associate",
    );
    expect(user.domain_id).toBe("ZZ90002");
  });
});

describe("admin_whitelist trimmed-email uniqueness", () => {
  it("refuses a whitespace-twin of an existing email", async () => {
    await db
      .insertInto("admin_whitelist")
      .values({ full_name: "Test", email: "zz@example.invalid", site: "all" })
      .execute();

    await expect(
      db
        .insertInto("admin_whitelist")
        .values({
          full_name: "Test",
          email: " zz@example.invalid",
          site: "all",
        })
        .execute(),
    ).rejects.toThrow(/admin_whitelist_email_lower_trim_idx/);
  });
});
