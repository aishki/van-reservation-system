import { type Kysely, sql } from "kysely";
import { ADMIN_WHITELIST_SEED } from "@/modules/auth/admin-whitelist-seed";
import type { DB } from "@/modules/db/types";

/**
 * Bootstraps `admin_whitelist` from `ADMIN_WHITELIST_SEED`.
 *
 * THIS SEED IS NO LONGER THE TABLE'S ONLY WRITER. `/roster` lets a
 * `super_admin` holder add, edit, deactivate and reactivate rows, so every
 * statement below is scoped to the rows this seed owns — the ones it just
 * upserted — and `active` is additionally withheld from any row a human has
 * put on or taken off the roster. See `humanManagedIds`.
 *
 * Idempotent, and still convergent for the seeded FIELDS: name, site,
 * identity and `super_admin` are written back on every run, so a correction
 * is applied by editing the seed data and running this again. That means a
 * `/roster` edit to one of those fields on a SEEDED row is reverted by the
 * next seed run — deliberate, and the same drift correction the placeholder
 * cleanup relies on. Someone who should keep an edit belongs in the seed data.
 */
export async function seed(db: Kysely<DB>): Promise<void> {
  const humanManaged = await humanManagedIds(db);
  const seeded: string[] = [];

  for (const row of ADMIN_WHITELIST_SEED) {
    const existing = await findSeedRow(db, row);

    if (existing === undefined) {
      const inserted = await db
        .insertInto("admin_whitelist")
        .values({
          full_name: row.full_name,
          email: row.email,
          domain_id: row.domain_id,
          site: row.site,
          super_admin: row.super_admin,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      seeded.push(inserted.id);
      continue;
    }

    // `active` is absent on purpose — `reactivateSeeded` decides that, and
    // only for rows no human has switched off.
    await db
      .updateTable("admin_whitelist")
      .set({
        full_name: row.full_name,
        email: row.email,
        domain_id: row.domain_id,
        site: row.site,
        super_admin: row.super_admin,
      })
      .where("id", "=", existing.id)
      .execute();
    seeded.push(existing.id);
  }

  await reactivateSeeded(db, seeded, humanManaged);
  await deactivateDeparted(db, seeded, humanManaged);
}

/**
 * The row this seed entry already owns, or `undefined` for a new person.
 *
 * Resolved by SELECT rather than by `onConflict`, and by Domain ID FIRST —
 * the same precedence `matchWhitelist` uses at login, and the reason is the
 * same: an email can be reassigned or edited, a Domain ID cannot. A single
 * `onConflict` cannot express that precedence. It has to pick one arbiter,
 * and either choice breaks a real correction:
 *
 * - the email index alone (what this used to do) misses a row whose address
 *   was edited through `/roster`, so the insert falls through and dies on
 *   `admin_whitelist_domain_id_idx` with a bare 23505;
 * - the Domain ID index alone misses a row whose Domain ID the seed is
 *   CORRECTING, and dies on the email index instead.
 *
 * Two selects cost nothing in a seed that writes eight rows once.
 *
 * The email fallback is not dead weight even though every entry in
 * `ADMIN_WHITELIST_SEED` carries a Domain ID today: `AdminSeedRow.domain_id` is
 * nullable, `admin_whitelist.domain_id` is nullable, and the fallback is what
 * fills in a Domain ID the seed has newly learned for a row already stored
 * without one. It is the only branch that can match such a row, and a seed
 * entry that ever goes back to `domain_id: null` depends on it entirely.
 */
async function findSeedRow(
  db: Kysely<DB>,
  row: { email: string; domain_id: string | null },
): Promise<{ id: string } | undefined> {
  if (row.domain_id !== null) {
    const byDomainId = await db
      .selectFrom("admin_whitelist")
      .select("id")
      .where("domain_id", "=", row.domain_id)
      .executeTakeFirst();
    if (byDomainId !== undefined) return byDomainId;
  }

  // Folded the same way `admin_whitelist_email_lower_trim_idx` and
  // `matchWhitelist` fold, so "found" here and "unique" there agree.
  return db
    .selectFrom("admin_whitelist")
    .select("id")
    .where(sql<boolean>`lower(trim(email)) = ${row.email.trim().toLowerCase()}`)
    .executeTakeFirst();
}

/**
 * Rows whose `active` state belongs to a person, not to this seed.
 *
 * A `/roster` create, deactivate or reactivate writes a `roster_events` row;
 * this seed writes none. So an id appearing here means somebody deliberately
 * put the row on the roster or took it off, and the seed must not overrule
 * them in either direction — it may neither switch off an admin added by hand
 * nor resurrect one retired by hand.
 *
 * `reactivated` is in the list for the direction that is easy to miss. This
 * seed retires a departed admin WITHOUT writing an event, because it owns that
 * row; a holder who then clicks Reactivate writes only a `reactivated` event.
 * Without it that row falls in neither `seeded` nor here, and the next deploy's
 * seed run retires them again — silently, forever. Putting someone back is as
 * deliberate an act as taking them off.
 *
 * `updated` is excluded: editing a seeded admin's site says nothing about
 * whether they should be active, and the seed still owns the seeded fields.
 */
async function humanManagedIds(db: Kysely<DB>): Promise<Set<string>> {
  const rows = await db
    .selectFrom("roster_events")
    .select("target_id")
    .distinct()
    .where("target_table", "=", "admin_whitelist")
    .where("event_type", "in", ["created", "deactivated", "reactivated"])
    .execute();
  return new Set(rows.map((row) => row.target_id));
}

/**
 * Undoes a PREVIOUS run's `deactivateDeparted` when the list is corrected: an
 * address fixed in the seed data brings that person back.
 *
 * Skips anything in `humanManaged`, so a holder who retired someone through
 * `/roster` does not find them back on the roster after the next deploy.
 */
async function reactivateSeeded(
  db: Kysely<DB>,
  seeded: string[],
  humanManaged: Set<string>,
): Promise<void> {
  const ids = seeded.filter((id) => !humanManaged.has(id));
  if (ids.length === 0) return;

  await db
    .updateTable("admin_whitelist")
    .set({ active: true })
    .where("id", "in", ids)
    .where("active", "=", false)
    .execute();
}

/**
 * Marks inactive any active row this seed did not just write.
 *
 * The per-row upsert above is idempotent but NOT convergent: it never notices a
 * row that has LEFT the list. Re-seeding after the placeholder addresses were
 * replaced left seven `@example.invalid` admins behind, still active — and an
 * unreachable address in a Cc makes SES reject the whole message as
 * `EMAIL_REJECTED`, which the dispatcher treats as permanent and never retries.
 * Every admin notification would have failed, silently and forever.
 *
 * Deactivated rather than deleted: `active = false` already excludes a row from
 * both `matchWhitelist` and `selectAdminEmails`, and keeping the row leaves a
 * visible record of who used to be an admin.
 *
 * SCOPED TO THE SEED'S OWN ROWS. The comment that used to sit here predicted a
 * whitelist admin UI and warned that this would have to become "deactivate rows
 * this seed created" — `/roster` landed, so it now is. Membership is decided by
 * `seeded`, the ids the loop above actually wrote, and anything a person
 * created through `/roster` is excluded on top of that: an admin added by hand
 * is absent from `ADMIN_WHITELIST_SEED` by definition, and switching them off
 * would be this seed silently overruling a holder.
 */
async function deactivateDeparted(
  db: Kysely<DB>,
  seeded: string[],
  humanManaged: Set<string>,
): Promise<void> {
  const kept = new Set(seeded);

  const rows = await db
    .selectFrom("admin_whitelist")
    .select("id")
    .where("active", "=", true)
    .execute();

  const departed = rows
    .map((row) => row.id)
    .filter((id) => !kept.has(id) && !humanManaged.has(id));

  if (departed.length === 0) return;

  await db
    .updateTable("admin_whitelist")
    .set({ active: false })
    .where("id", "in", departed)
    .execute();
}
