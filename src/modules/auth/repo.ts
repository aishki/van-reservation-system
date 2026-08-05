import { type Kysely, type Selectable, sql } from "kysely";
import type { AuthIdentity } from "@/modules/auth/provider";
import type { AdminSite, AppRole, WhitelistEntry } from "@/modules/auth/roles";
import type { DB, Users } from "@/modules/db/types";

export type UserRow = Selectable<Users>;

/**
 * One statement, so a first login cannot race itself into two rows. The role is
 * written every time: whitelist changes take effect on next login (existing
 * sessions retain their role until expiry), no deploy.
 */
export async function upsertUser(
  db: Kysely<DB>,
  identity: AuthIdentity,
  role: AppRole,
): Promise<UserRow> {
  return db
    .insertInto("users")
    .values({
      // CGS may echo any case; the whitelist index and reservation FKs key on
      // the canonical upper form.
      domain_id: identity.domainId.toUpperCase(),
      name: identity.name,
      email: identity.email,
      mobile_number: identity.contactNumber ?? null,
      role,
      last_login_at: sql`now()`,
    })
    .onConflict((oc) =>
      oc.column("domain_id").doUpdateSet({
        name: identity.name,
        email: identity.email,
        mobile_number: identity.contactNumber ?? null,
        role,
        last_login_at: sql`now()`,
        updated_at: sql`now()`,
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function listActiveWhitelist(
  db: Kysely<DB>,
): Promise<WhitelistEntry[]> {
  const rows = await db
    .selectFrom("admin_whitelist")
    .select(["domain_id", "email", "site", "active", "super_admin"])
    .where("active", "=", true)
    .execute();

  return rows.map((row) => ({
    domain_id: row.domain_id,
    email: row.email,
    site: row.site as AdminSite,
    active: row.active,
    super_admin: row.super_admin,
  }));
}
