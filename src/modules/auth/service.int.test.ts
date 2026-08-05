import type { Kysely } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { type AuthDeps, authenticate } from "@/modules/auth/service";
import { StubAuthProvider } from "@/modules/auth/stub";
import type { DB } from "@/modules/db/types";
import { testDb, withRollback } from "../../../test/with-rollback";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const request = (body: unknown) =>
  new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const deps = (trx: Kysely<DB>): AuthDeps => ({
  db: trx,
  provider: new StubAuthProvider("test"),
});

const juan = {
  domainId: "AB12345",
  name: "Juan Dela Cruz",
  email: "juan.delacruz@carelon.com",
};

const whitelistJuan = (trx: Kysely<DB>) =>
  trx
    .insertInto("admin_whitelist")
    .values({
      full_name: "Juan Admin",
      email: "juan.delacruz@carelon.com",
      site: "iloilo",
    })
    .execute();

describe("authenticate", () => {
  it("returns a session for any authenticated associate", async () => {
    await withRollback(db, async (trx) => {
      const result = await authenticate(deps(trx), request(juan), "requestor");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.role).toBe("associate");
      expect(result.value.domainId).toBe("AB12345");
      expect(result.value.userId).toBeTruthy();
    });
  });

  it("assigns admin_support to a whitelisted email at the admin door (FR-5)", async () => {
    await withRollback(db, async (trx) => {
      await whitelistJuan(trx);

      const result = await authenticate(deps(trx), request(juan), "admin");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.role).toBe("admin_support");
    });
  });

  // The admin whitelist decides the ROLE, never admission — an associate absent
  // from it signs in as `associate` rather than being turned away.
  it("admits an associate who is on no whitelist", async () => {
    await withRollback(db, async (trx) => {
      const result = await authenticate(deps(trx), request(juan), "requestor");
      expect(result.ok && result.value.role).toBe("associate");

      const found = await trx
        .selectFrom("users")
        .select("id")
        .where("domain_id", "=", "AB12345")
        .executeTakeFirst();
      expect(found).toBeDefined();
    });
  });

  it("fails with NOT_AUTHENTICATED when the provider yields nothing", async () => {
    await withRollback(db, async (trx) => {
      const result = await authenticate(
        deps(trx),
        request({ domainId: "" }),
        "requestor",
      );
      expect(result).toEqual({ ok: false, error: "NOT_AUTHENTICATED" });
    });
  });

  it("creates no user record when the credential is refused", async () => {
    await withRollback(db, async (trx) => {
      await authenticate(
        deps(trx),
        request({ domainId: "ZZ99999" }),
        "requestor",
      );
      const found = await trx
        .selectFrom("users")
        .select("id")
        .where("domain_id", "=", "ZZ99999")
        .executeTakeFirst();
      expect(found).toBeUndefined();
    });
  });
});

/**
 * The whitelist decides the role at the ADMIN door and nowhere else.
 *
 * Before this, a whitelisted Domain ID signing in at /login was handed an
 * admin session and redirected to the dashboard — one person could not be a
 * requestor at all if they were also an admin.
 */
describe("authenticate portals", () => {
  it("gives a whitelisted Domain ID an ASSOCIATE session at the requestor door", async () => {
    await withRollback(db, async (trx) => {
      await whitelistJuan(trx);

      const result = await authenticate(deps(trx), request(juan), "requestor");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.role).toBe("associate");
    });
  });

  // `users.role` records what the whitelist says this person COULD be, so it
  // does not flap with whichever door was last used. Nothing authorizes off it
  // — every check reads the session — which is what makes storing the wider
  // value a record rather than a grant.
  it("still stores the whitelisted capability on the user row", async () => {
    await withRollback(db, async (trx) => {
      await whitelistJuan(trx);

      await authenticate(deps(trx), request(juan), "requestor");

      const row = await trx
        .selectFrom("users")
        .select("role")
        .where("domain_id", "=", "AB12345")
        .executeTakeFirstOrThrow();
      expect(row.role).toBe("admin_support");
    });
  });

  it("refuses a non-whitelisted Domain ID at the admin door", async () => {
    await withRollback(db, async (trx) => {
      const result = await authenticate(deps(trx), request(juan), "admin");
      expect(result).toEqual({ ok: false, error: "FORBIDDEN" });
    });
  });

  // Refused before `upsertUser`, so a sign-in that produced no session cannot
  // leave a `last_login_at` claiming it did.
  it("records no login when the admin door refuses", async () => {
    await withRollback(db, async (trx) => {
      await authenticate(deps(trx), request(juan), "admin");

      const found = await trx
        .selectFrom("users")
        .select("id")
        .where("domain_id", "=", "AB12345")
        .executeTakeFirst();
      expect(found).toBeUndefined();
    });
  });
});
