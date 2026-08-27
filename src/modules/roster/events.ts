import type { Transaction } from "kysely";
import type { FieldChange } from "@/modules/audit/types";
import type { DB } from "@/modules/db/types";
import type {
  RosterActor,
  RosterEventType,
  RosterTarget,
} from "@/modules/roster/types";

/**
 * The trail every roster write owes.
 *
 * `Transaction<DB>`, never `Kysely<DB>`: the type system is what stops a caller
 * logging outside the transaction that made the change. A change with no trail
 * and a trail with no change must both be impossible.
 */

/** A field eligible for the audit trail, with the label the log will show. */
export interface FieldSpec {
  field: string;
  label: string;
}

/**
 * One side of a change, as a DISPLAY string.
 *
 * `roster_events` is append-only, so a row must carry everything needed to read
 * it back later without re-deriving anything from a schema that has since
 * moved. `null` means the field held nothing — distinct from `""`, which the
 * audit page would render as a present-but-blank value.
 */
function display(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value);
  return text === "" ? null : text;
}

/**
 * Which of `specs` moved between `before` and `after`.
 *
 * `specs` is an ALLOWLIST, not a convenience: iterating the objects' own keys
 * would put any column somebody later adds into a permanent log, which is how a
 * secret ends up in an audit trail. Order follows `specs`, so the log reads the
 * same way every time regardless of object key order.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  specs: readonly FieldSpec[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const spec of specs) {
    // A field the caller did not supply is "unchanged", not "cleared" — a PATCH
    // carries only what moved.
    if (!(spec.field in after)) continue;
    const from = display(before[spec.field]);
    const to = display(after[spec.field]);
    if (from === to) continue;
    changes.push({ field: spec.field, label: spec.label, from, to });
  }
  return changes;
}

export interface RosterEventEntry {
  target: RosterTarget;
  targetId: string;
  eventType: RosterEventType;
  actor: RosterActor;
  /** Null for created/deactivated/reactivated, where the event IS the change. */
  changes: FieldChange[] | null;
}

export async function recordRosterEvent(
  trx: Transaction<DB>,
  entry: RosterEventEntry,
): Promise<void> {
  await trx
    .insertInto("roster_events")
    .values({
      target_table: entry.target,
      target_id: entry.targetId,
      event_type: entry.eventType,
      actor_user_id: entry.actor.userId,
      actor_name: entry.actor.name,
      actor_role: entry.actor.role,
      // Wrapped in `{ fields }`, matching `reservation_events` and what
      // `parseChanges` reads. A bare array is rejected by its first line, so an
      // unwrapped payload stores correctly and renders as nothing at all.
      changes:
        entry.changes === null || entry.changes.length === 0
          ? null
          : JSON.stringify({ fields: entry.changes }),
    })
    .execute();
}
