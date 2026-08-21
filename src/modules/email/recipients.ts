import type { Kysely } from "kysely";
import type { DB } from "@/modules/db/types";
import { SITE_TO_DB } from "@/modules/reservations/db-map";
import type { SiteLocation } from "@/modules/reservations/types";

/**
 * Who receives the admin notifications — the one place that decision is made.
 *
 * The three templates render the same body for every admin and know nothing
 * about who they are, so without this the `site in (booking's site, 'all')` rule
 * would be repeated at each enqueue site in `write.ts` and drift.
 *
 * `site` is a NOTIFICATION filter, never a permission boundary: Admin Support is
 * one flat role and any admin may act on any request (see `types.ts`'s scope
 * note). An `'all'` row is someone who wants both offices' mail.
 */

/**
 * The shape the rule needs — satisfied by an `admin_whitelist` row and by an
 * `ADMIN_WHITELIST_SEED` entry alike, which is the point: the dev preview
 * resolves its To/Cc from the seed through this same function, so a
 * hand-maintained address list cannot drift from what production would send.
 */
export interface NotifiableAdmin {
  full_name: string;
  email: string | null;
  site: string;
  notify?: boolean;
  active?: boolean;
}

/**
 * The rule itself, pure. Ordered by name so the Cc header reads the same way
 * every time.
 *
 * `notify` and `active` default to true when absent: `ADMIN_WHITELIST_SEED` rows
 * carry neither and the table defaults both to true, so a seed row is a
 * notifiable, active admin unless the database says otherwise.
 *
 * `exclude` drops one address — pass the requestor's. An Admin Support member is
 * also an associate who books vans (the submit route says so explicitly), so
 * without this an admin booking their own van appears in both `to` and `cc` and
 * receives the approval twice. Compared case-folded, because the whitelist
 * stores lower-case and a session address may not be.
 */
export function selectAdminEmails(
  rows: readonly NotifiableAdmin[],
  site: SiteLocation,
  exclude?: string,
): string[] {
  const wanted = new Set([SITE_TO_DB[site], "all"]);
  const excluded = exclude?.trim().toLowerCase();

  return (
    rows
      .filter((row) => (row.active ?? true) && (row.notify ?? true))
      .filter((row) => wanted.has(row.site))
      .slice()
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map((row) => row.email)
      // A whitelist row may identify someone by Domain ID alone — the table's
      // CHECK requires email OR domain_id, not both. Such a row can grant the
      // admin role but cannot receive mail, so it is dropped here rather than
      // producing a null that fails `sendEmail`'s validation later.
      .filter((email): email is string => email !== null && email.trim() !== "")
      .filter((email) => email.toLowerCase() !== excluded)
  );
}

/**
 * `selectAdminEmails` against the live table. The whole table is read rather
 * than filtered in SQL so that the rule has exactly ONE implementation — it
 * holds eight rows, and a WHERE clause here that the preview's seed path could
 * not share is how the two would diverge.
 */
export async function adminRecipients(
  db: Kysely<DB>,
  site: SiteLocation,
  exclude?: string,
): Promise<string[]> {
  const rows = await db
    .selectFrom("admin_whitelist")
    .select(["full_name", "email", "site", "notify", "active"])
    .execute();

  return selectAdminEmails(rows, site, exclude);
}
