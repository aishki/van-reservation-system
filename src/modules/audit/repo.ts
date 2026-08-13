import type { Kysely } from "kysely";
import { instantFromManila, instantInManila } from "@/lib/tz";
import { parseChanges } from "@/modules/audit/changes";
import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditCursor,
  type AuditEntry,
} from "@/modules/audit/types";
import type { DB } from "@/modules/db/types";
import { siteFromDb } from "@/modules/reservations/db-map";

/**
 * Reading the admin action log.
 *
 * A view over `reservation_events`, not a table of its own: every write path
 * already records what it did there, and a second log would be a second thing
 * to keep in sync — with the failure mode that the two disagree and neither can
 * be trusted.
 */

/** A cap a caller can raise is not a cap, so it lives here as well as in zod. */
export const MAX_AUDIT_LIMIT = 100;

export interface AuditQuery {
  action: AuditAction | null;
  /** Case-insensitive substring of the actor's name. */
  actor: string | null;
  /** Inclusive plain Manila dates. */
  from: string | null;
  to: string | null;
  limit: number;
  cursor: AuditCursor | null;
}

export interface AuditPage {
  entries: AuditEntry[];
  /** Null on the last page. */
  nextCursor: AuditCursor | null;
}

export async function listAuditEntries(
  db: Kysely<DB>,
  query: AuditQuery,
): Promise<AuditPage> {
  const limit = Math.min(Math.max(1, query.limit), MAX_AUDIT_LIMIT);

  let qb = db
    .selectFrom("reservation_events as e")
    .innerJoin("reservations as r", "r.id", "e.reservation_id")
    .select([
      "e.id",
      "e.created_at",
      "e.event_type",
      "e.actor_name",
      "e.remark",
      "e.changes",
      "r.reference_no",
      "r.requestor_name",
      "r.site",
      "r.start_at",
      "r.purpose",
    ])
    // The scope, applied HERE rather than in the route: the log answers "what
    // did an admin do", and a scope a query parameter can widen is not a scope.
    .where("e.actor_role", "=", "admin_support")
    .where("e.event_type", "in", [...AUDIT_ACTIONS]);

  if (query.action !== null) {
    qb = qb.where("e.event_type", "=", query.action);
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

  // Keyset, not offset. The log grows at its HEAD, so an offset page shifts
  // under the reader between requests and rows are shown twice or skipped.
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

  // One row more than asked for, so "is there a next page" is answered by this
  // query rather than by a second one that could disagree with it.
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
  event_type: string;
  actor_name: string | null;
  remark: string | null;
  changes: unknown;
  reference_no: string;
  requestor_name: string;
  site: string;
  start_at: Date;
  purpose: string;
}): AuditEntry {
  const start = instantInManila(row.start_at);
  return {
    id: row.id,
    at: row.created_at.toISOString(),
    // The `event_type in AUDIT_ACTIONS` filter above is what makes this cast
    // sound; the column itself is a plain string in the generated types.
    action: row.event_type as AuditAction,
    // A `submitted` event can carry a null actor (the system), but every action
    // in AUDIT_ACTIONS is a human one — the coherence CHECK constraint pairs
    // the three actor columns, so this is a defensive default, not a real case.
    actorName: row.actor_name ?? "System",
    reference: row.reference_no,
    requestor: row.requestor_name,
    site: siteFromDb(row.site),
    startDate: start?.date ?? "",
    purpose: row.purpose,
    remark: row.remark,
    changes: parseChanges(row.changes),
  };
}
