import { type Kysely, sql, type Transaction, type Updateable } from "kysely";
import { err, ok, type Result } from "@/lib/result";
import type { AdminEntry } from "@/modules/admins/types";
import { listActiveWhitelist } from "@/modules/auth/repo";
import {
  type AdminSite,
  type RoleIdentity,
  resolveSuperAdmin,
} from "@/modules/auth/roles";
import type { AdminWhitelist, DB } from "@/modules/db/types";
import {
  diffFields,
  type FieldSpec,
  recordRosterEvent,
} from "@/modules/roster/events";
import {
  ROSTER_MESSAGES,
  type RosterActor,
  type RosterFailure,
} from "@/modules/roster/types";
import {
  type AdminCreate,
  type AdminPatch,
  fieldForConstraint,
  UNIQUE_VIOLATION,
} from "@/modules/roster/wire";

/**
 * The admin whitelist as an editable roster.
 *
 * The guardrails live HERE rather than in the route handlers, so no future
 * caller can route around them. They stop foot-guns, not a hostile admin: a
 * holder can grant the flag to another holder, which was an accepted trade when
 * the column was chosen over a hardcoded list.
 */

const COLUMNS = [
  "id",
  "full_name",
  "email",
  "domain_id",
  "site",
  "notify",
  "active",
  "super_admin",
] as const;

function toAdmin(row: {
  id: string;
  full_name: string;
  email: string | null;
  domain_id: string | null;
  site: string;
  notify: boolean;
  active: boolean;
  super_admin: boolean;
}): AdminEntry {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    domainId: row.domain_id,
    // Cast, as in `listActiveWhitelist`: the column's CHECK admits exactly
    // ADMIN_SITES, which schema-constraints.int.test.ts pins.
    site: row.site as AdminSite,
    notify: row.notify,
    active: row.active,
    superAdmin: row.super_admin,
  };
}

/**
 * The whole whitelist, inactive rows included — the audit log has to name the
 * person whose access was removed, not hide them.
 */
export async function listAdmins(db: Kysely<DB>): Promise<AdminEntry[]> {
  const rows = await db
    .selectFrom("admin_whitelist")
    .select(COLUMNS)
    .orderBy("full_name", "asc")
    .execute();

  return rows.map(toAdmin);
}

/**
 * Whether this identity may edit the whitelist, read from the DATABASE.
 *
 * Every `/api/admins` handler calls this instead of trusting
 * `SessionUser.superAdmin`. A capability baked into a signed cookie outlives its
 * revocation: demote someone and they keep editing until they happen to log out.
 *
 * Delegates to the SAME matcher login uses, so "can sign in as this row" and
 * "isSuperAdmin agrees" cannot diverge. Matching on Domain ID alone left a
 * lockout open that no guardrail below covers: clearing the last holder's
 * `domain_id` keeps the holder count above zero while making the capability
 * unreachable for everyone.
 */
export async function isSuperAdmin(
  db: Kysely<DB>,
  identity: RoleIdentity,
): Promise<boolean> {
  return resolveSuperAdmin(identity, await listActiveWhitelist(db));
}

/**
 * The fields eligible for the audit trail, with the labels the log shows.
 *
 * An ALLOWLIST — `diffFields` iterates this rather than the row's own keys, so a
 * column added later cannot leak into a permanent log. `active` is absent by
 * design: `setAdminActive` owns activation and logs its own event type, which is
 * also why `adminPatchSchema` does not carry the field.
 */
const ADMIN_FIELDS: FieldSpec[] = [
  { field: "fullName", label: "Name" },
  { field: "email", label: "Email" },
  { field: "domainId", label: "Domain ID" },
  { field: "site", label: "Site" },
  { field: "notify", label: "Receives notifications" },
  { field: "superAdmin", label: "Manages the whitelist" },
];

/**
 * A duplicate email or Domain ID, attributed to its input.
 *
 * Caught rather than pre-checked with a `select`: two concurrent creates both
 * see the address free and one then fails anyway. The database is the only
 * authority on uniqueness.
 */
function asFailure(error: unknown): RosterFailure | null {
  const code = (error as { code?: string })?.code;
  if (code !== UNIQUE_VIOLATION) return null;

  const message = String((error as { message?: string })?.message ?? "");
  const field = fieldForConstraint(message);
  if (field === "email") {
    return {
      code: "VALIDATION_FAILED",
      message: ROSTER_MESSAGES.duplicateEmail,
      field,
    };
  }
  if (field === "domainId") {
    return {
      code: "VALIDATION_FAILED",
      message: ROSTER_MESSAGES.duplicateDomainId,
      field,
    };
  }
  // An unmapped violation is a real error, not something to blame on an
  // arbitrary input.
  return null;
}

/**
 * Serialises every write that could reduce the number of people able to manage
 * the whitelist.
 *
 * A row lock on the target is NOT enough, and believing otherwise is the trap
 * here: two transactions demoting DIFFERENT rows never contend for a row, and
 * `activeHolderCount` is a plain read that MVCC never blocks — so both see two
 * holders, both allow, and zero remain. Verified by removing this call and
 * watching "holds under two CONCURRENT demotions" fail.
 *
 * Transaction-scoped, so it releases on commit or rollback with nothing to
 * clean up, and taken FIRST in both writers, so it cannot deadlock against the
 * row locks below. Taken unconditionally rather than only for a demotion: the
 * table holds eight rows edited by hand, so the serialisation costs nothing,
 * and a future field that also sheds a holder cannot forget to ask for it.
 *
 * The key is an arbitrary constant unique to this invariant; nothing else in
 * the codebase takes an advisory lock.
 */
const HOLDER_COUNT_LOCK = 8410372;

async function lockHolderCount(trx: Transaction<DB>): Promise<void> {
  await sql`select pg_advisory_xact_lock(${HOLDER_COUNT_LOCK})`.execute(trx);
}

/**
 * How many people can still manage the whitelist, counting only ACTIVE rows —
 * an inactive holder manages nothing.
 *
 * MUST be called inside the caller's transaction, after `lockHolderCount` —
 * that lock, not this count, is what makes the answer still true at commit.
 */
async function activeHolderCount(trx: Transaction<DB>): Promise<number> {
  const row = await trx
    .selectFrom("admin_whitelist")
    .select(trx.fn.countAll().as("n"))
    .where("super_admin", "=", true)
    .where("active", "=", true)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/**
 * Whether this whitelist row IS the actor.
 *
 * Deliberately BROADER than `matchWhitelist`: a row matching on EITHER key
 * counts as the actor's own. `matchWhitelist` picks one winner among many rows
 * and so lets Domain ID short-circuit the email; this asks a yes/no question
 * about one row, where over-refusing costs an admin one extra step and
 * under-refusing costs them their access. A row with a mistyped `domain_id` but
 * the actor's email still signs them in, and must still count as their own.
 *
 * Case handling follows each key's storage: `admin_whitelist_domain_id_idx` is
 * a plain unique index so IDs compare verbatim, while the email index is on
 * `lower(trim(email))`.
 *
 * A blank string is NOT a key — see `asKey` in `roles.ts`. `email = ''` is
 * schema-legal, and treating it as one would make every email-less row look
 * like the actor's own.
 */
function isOwnRow(
  row: { domain_id: string | null; email: string | null },
  actor: RosterActor,
): boolean {
  const rowId = row.domain_id?.trim() ?? "";
  const actorId = actor.domainId.trim();
  if (rowId !== "" && actorId !== "" && rowId === actorId) return true;

  const rowEmail = row.email?.trim().toLowerCase() ?? "";
  const actorEmail = actor.email?.trim().toLowerCase() ?? "";
  return rowEmail !== "" && rowEmail === actorEmail;
}

/** A trimmed-empty string is not an identity key — see `asKey` in roles.ts. */
const hasKey = (value: string | null) => (value?.trim() ?? "") !== "";

export async function createAdmin(
  db: Kysely<DB>,
  input: AdminCreate,
  actor: RosterActor,
): Promise<Result<AdminEntry, RosterFailure>> {
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto("admin_whitelist")
        .values({
          full_name: input.fullName,
          email: input.email,
          domain_id: input.domainId,
          site: input.site,
          notify: input.notify,
          super_admin: input.superAdmin,
        })
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();

      await recordRosterEvent(trx, {
        target: "admin_whitelist",
        targetId: row.id,
        eventType: "created",
        actor,
        // A creation is its own change; there is no before-state to diff.
        changes: null,
      });

      return ok(toAdmin(row));
    });
  } catch (error) {
    const failure = asFailure(error);
    if (failure === null) throw error;
    return err(failure);
  }
}

export async function updateAdmin(
  db: Kysely<DB>,
  id: string,
  input: AdminPatch,
  actor: RosterActor,
): Promise<Result<AdminEntry, RosterFailure>> {
  try {
    return await db.transaction().execute(async (trx) => {
      // Before anything is read: guardrail 3's count is only meaningful while
      // this is held. `createAdmin` needs no such lock — it can only ADD
      // holders.
      await lockHolderCount(trx);

      // Locked, so a concurrent edit cannot make the diff describe a state that
      // never existed.
      const before = await trx
        .selectFrom("admin_whitelist")
        .select(COLUMNS)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();

      if (before === undefined) {
        return err({ code: "NOT_FOUND", message: ROSTER_MESSAGES.notFound });
      }

      // Guardrail 1. Locking yourself out takes a deploy to undo.
      //
      // Matched on IDENTITY, never on `before.id === actor.userId`:
      // `admin_whitelist.id` and `users.id` are different tables, so that
      // comparison is always false and the guardrail would never fire.
      if (input.superAdmin === false && isOwnRow(before, actor)) {
        return err({ code: "FORBIDDEN", message: ROSTER_MESSAGES.selfDemote });
      }

      // Guardrail 4. Mirrors `admin_whitelist_identity_check`, evaluated over
      // `row ⊕ input`. `adminPatchSchema` cannot do this — a partial patch
      // cannot see the row it merges into. Without it, a patch that nulls
      // whichever half the row was relying on reaches Postgres and comes back
      // as a raw constraint violation: a 500 naming no field, where the create
      // path gives a message. A blank string is not a key here either.
      const mergedEmail =
        input.email === undefined ? before.email : input.email;
      const mergedDomainId =
        input.domainId === undefined ? before.domain_id : input.domainId;
      if (!hasKey(mergedEmail) && !hasKey(mergedDomainId)) {
        return err({
          code: "VALIDATION_FAILED",
          message: ROSTER_MESSAGES.identityRequired,
          field: "email",
        });
      }

      // Guardrail 3. Inside the transaction, under `lockHolderCount` — so the
      // count is still true when this transaction commits.
      // Demotion only: `active` is not part of `adminPatchSchema`, so a
      // deactivation cannot arrive here. `setAdminActive` owns that half.
      // `before.active` matches `setAdminActive`'s half: demoting an ALREADY
      // inactive holder sheds nothing `activeHolderCount` was counting.
      const losingAHolder =
        input.superAdmin === false && before.super_admin && before.active;
      if (losingAHolder && (await activeHolderCount(trx)) <= 1) {
        return err({
          code: "INVALID_TRANSITION",
          message: ROSTER_MESSAGES.lastSuperAdmin,
        });
      }

      // Built from the patch's PRESENT keys only. An absent field means
      // "unchanged", never "set to null".
      const update: Updateable<AdminWhitelist> = {};
      if (input.fullName !== undefined) update.full_name = input.fullName;
      if (input.email !== undefined) update.email = input.email;
      if (input.domainId !== undefined) update.domain_id = input.domainId;
      if (input.site !== undefined) update.site = input.site;
      if (input.notify !== undefined) update.notify = input.notify;
      if (input.superAdmin !== undefined) update.super_admin = input.superAdmin;

      const changes = diffFields(
        {
          fullName: before.full_name,
          email: before.email,
          domainId: before.domain_id,
          site: before.site,
          notify: before.notify,
          superAdmin: before.super_admin,
        },
        { ...input },
        ADMIN_FIELDS,
      );

      // Nothing moved: no write, and no event. An audit row for a change that
      // did not happen makes the whole log untrustworthy.
      if (changes.length === 0) return ok(toAdmin(before));

      const row = await trx
        .updateTable("admin_whitelist")
        // No `updated_at`: unlike drivers and vans, this table carries only
        // `created_at`. The trail lives in `roster_events`.
        .set(update)
        .where("id", "=", id)
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();

      await recordRosterEvent(trx, {
        target: "admin_whitelist",
        targetId: id,
        eventType: "updated",
        actor,
        changes,
      });

      return ok(toAdmin(row));
    });
  } catch (error) {
    const failure = asFailure(error);
    if (failure === null) throw error;
    return err(failure);
  }
}

/**
 * Deactivation is the whole of removal — there is no delete, because the audit
 * log's `target_id` has no foreign key to lean on and a deleted row would leave
 * every event about it dangling.
 *
 * The event type is `deactivated` / `reactivated` rather than `updated`, because
 * "who removed this person's access" is the question the log is most often
 * asked.
 */
export async function setAdminActive(
  db: Kysely<DB>,
  id: string,
  active: boolean,
  actor: RosterActor,
): Promise<Result<AdminEntry, RosterFailure>> {
  return db.transaction().execute(async (trx) => {
    // Same ordering as `updateAdmin`: the holder-count lock first, so two
    // concurrent deactivations of two different holders cannot both pass.
    await lockHolderCount(trx);

    const before = await trx
      .selectFrom("admin_whitelist")
      .select(COLUMNS)
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();

    if (before === undefined) {
      return err({ code: "NOT_FOUND", message: ROSTER_MESSAGES.notFound });
    }

    // Guardrail 2. Same identity match as guardrail 1, and for the same reason.
    if (!active && isOwnRow(before, actor)) {
      return err({
        code: "FORBIDDEN",
        message: ROSTER_MESSAGES.selfDeactivate,
      });
    }

    // Guardrail 3, deactivation half: taking the last active holder off the
    // roster removes the flag just as surely as demoting them.
    const losingAHolder = !active && before.super_admin && before.active;
    if (losingAHolder && (await activeHolderCount(trx)) <= 1) {
      return err({
        code: "INVALID_TRANSITION",
        message: ROSTER_MESSAGES.lastSuperAdmin,
      });
    }

    // Already in that state: no write, and no event — the same rule
    // `updateAdmin` applies to an empty diff. Reachable from the UI, not just
    // the API: the roster table computes `!row.active` from cached query data,
    // so a stale row deactivates something already deactivated.
    //
    // AFTER both guardrails, deliberately. Moving it above guardrail 2 would
    // turn "you cannot deactivate your own account" into a silent `ok` the
    // moment the row is already inactive, which is a refusal being skipped
    // rather than a no-op being detected.
    if (before.active === active) return ok(toAdmin(before));

    const row = await trx
      .updateTable("admin_whitelist")
      .set({ active })
      .where("id", "=", id)
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();

    await recordRosterEvent(trx, {
      target: "admin_whitelist",
      targetId: id,
      eventType: active ? "reactivated" : "deactivated",
      actor,
      changes: null,
    });

    return ok(toAdmin(row));
  });
}
