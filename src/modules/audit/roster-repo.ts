import type { Kysely } from "kysely";
import { instantFromManila } from "@/lib/tz";
import { parseChanges } from "@/modules/audit/changes";
import { MAX_AUDIT_LIMIT } from "@/modules/audit/repo";
import type { AuditCursor, RosterAuditEntry } from "@/modules/audit/types";
import type { DB } from "@/modules/db/types";
import type { RosterEventType, RosterTarget } from "@/modules/roster/types";

/**
 * Reading the roster change log.
 *
 * Mirrors `listAuditEntries` in `repo.ts`: the same `limit + 1` fetch, keyset
 * predicate, Manila date bounds, and `MAX_AUDIT_LIMIT` clamp. The one
 * structural difference is `subject`, resolved by joining the target's
 * CURRENT row rather than snapshotting a display string at write time — see
 * `toEntry`.
 */

/**
 * Whether the caller may see `admin_whitelist` events.
 *
 * A separate argument, never a query field: `RosterAuditQuery` is parsed from
 * the URL, and a scope a client can spell is not a scope. The route resolves
 * this from `isSuperAdmin` — the same database read `/api/admins` and
 * `/roster` gate on — so the log cannot hand a plain `admin_support` user the
 * names, emails and Domain IDs that `/api/admins` withholds from them.
 */
export interface RosterAuditScope {
  includeAdminTargets: boolean;
}

export interface RosterAuditQuery {
  eventType: RosterEventType | null;
  /** Case-insensitive substring of the actor's name. */
  actor: string | null;
  /** Inclusive plain Manila dates. */
  from: string | null;
  to: string | null;
  limit: number;
  cursor: AuditCursor | null;
}

export interface RosterAuditPage {
  entries: RosterAuditEntry[];
  /** Null on the last page. */
  nextCursor: AuditCursor | null;
}

export async function listRosterEvents(
  db: Kysely<DB>,
  query: RosterAuditQuery,
  scope: RosterAuditScope,
): Promise<RosterAuditPage> {
  const limit = Math.min(Math.max(1, query.limit), MAX_AUDIT_LIMIT);

  // `target_id` is a UUID and the three tables' ids do not collide, so at
  // most one of these three joins matches per row.
  let qb = db
    .selectFrom("roster_events as e")
    .leftJoin("drivers as d", "d.id", "e.target_id")
    .leftJoin("vans as v", "v.id", "e.target_id")
    .leftJoin("admin_whitelist as a", "a.id", "e.target_id")
    .select([
      "e.id",
      "e.created_at",
      "e.target_table",
      "e.event_type",
      "e.actor_name",
      "e.changes",
      "d.name as driver_name",
      "v.van_number as van_number",
      "a.full_name as admin_name",
    ])
    // The scope, applied HERE rather than in the route — same reasoning as
    // `listAuditEntries`: a scope a query parameter can widen is not a scope.
    .where("e.actor_role", "=", "admin_support");

  // The capability half of the scope, applied HERE for the same reason and
  // from a boolean the caller resolved against the database, not the request.
  if (!scope.includeAdminTargets) {
    qb = qb.where("e.target_table", "!=", "admin_whitelist");
  }

  if (query.eventType !== null) {
    qb = qb.where("e.event_type", "=", query.eventType);
  }
  if (query.actor !== null && query.actor.trim() !== "") {
    qb = qb.where("e.actor_name", "ilike", `%${query.actor.trim()}%`);
  }
  if (query.from !== null) {
    const start = instantFromManila(query.from, "00:00");
    if (start !== null) qb = qb.where("e.created_at", ">=", start);
  }
  if (query.to !== null) {
    // 23:59, not 00:00: the bound is an inclusive DAY, and an admin filtering
    // "today" would otherwise see nothing recorded after Manila midnight.
    const end = instantFromManila(query.to, "23:59");
    if (end !== null) qb = qb.where("e.created_at", "<=", end);
  }

  // Keyset, not offset — same reason as `listAuditEntries`: the log grows at
  // its HEAD, so an offset page shifts under the reader between requests.
  // `id` is the tiebreak because `created_at` ties are routine — every event
  // written in one transaction shares a timestamp.
  const cursor = query.cursor;
  if (cursor !== null) {
    const at = new Date(cursor.at);
    qb = qb.where((eb) =>
      eb.or([
        eb("e.created_at", "<", at),
        eb.and([eb("e.created_at", "=", at), eb("e.id", "<", cursor.id)]),
      ]),
    );
  }

  // One row more than asked for, so "is there a next page" is answered by
  // this query rather than by a second one that could disagree with it.
  const rows = await qb
    .orderBy("e.created_at", "desc")
    .orderBy("e.id", "desc")
    .limit(limit + 1)
    .execute();

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last !== undefined
      ? { at: last.created_at.toISOString(), id: last.id }
      : null;

  return { entries: page.map(toEntry), nextCursor };
}

function toEntry(row: {
  id: string;
  created_at: Date;
  target_table: string;
  event_type: string;
  actor_name: string;
  changes: unknown;
  driver_name: string | null;
  van_number: string | null;
  admin_name: string | null;
}): RosterAuditEntry {
  // The row's target by its CURRENT name. "(removed)" cannot normally
  // happen — roster rows are never deleted — so it marks a broken invariant
  // rather than an expected case, and says so instead of rendering an empty
  // cell.
  const subject =
    row.driver_name ?? row.van_number ?? row.admin_name ?? "(removed)";

  return {
    id: row.id,
    at: row.created_at.toISOString(),
    // The `target_table` CHECK constraint is what makes this cast sound.
    target: row.target_table as RosterTarget,
    // The `event_type` CHECK constraint is what makes this cast sound.
    eventType: row.event_type as RosterEventType,
    actorName: row.actor_name,
    subject,
    changes: parseChanges(row.changes),
  };
}
