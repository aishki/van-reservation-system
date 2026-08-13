import type { SiteLocation } from "@/modules/reservations/types";
import type { RosterEventType, RosterTarget } from "@/modules/roster/types";

/**
 * One field that moved, with both sides as DISPLAY strings.
 *
 * Strings, not raw values, and formatted at WRITE time rather than at render
 * time: `reservation_events` is append-only, so a row must carry everything
 * needed to read it back years later without re-deriving anything from a schema
 * that has since moved. Dates go through `lib/tz` for the same reason every
 * other human-facing date does — an instant rendered in the wrong zone reads as
 * the previous day.
 */
export interface FieldChange {
  /** A `TRIP_FIELDS` member, or `"driver"` / `"van"`. */
  field: string;
  /** Human label, e.g. `"Pickup point"`. */
  label: string;
  /** `null` means the field held nothing before. */
  from: string | null;
  to: string | null;
}

/**
 * How a `reservation_events.changes` value read back.
 *
 * Three cases because the column is append-only jsonb written by two
 * generations of this code, and the older rows cannot be migrated: the values
 * they omit were never captured.
 */
export type ParsedChanges =
  | { kind: "fields"; changes: FieldChange[] }
  /** Legacy rows: field names only. No values were captured. */
  | { kind: "names"; fields: string[] }
  | { kind: "none" };

/**
 * The actions an ADMIN takes. `submitted` is absent: the audit log answers
 * "what did an admin do", and a submission is the requestor's act.
 */
export const AUDIT_ACTIONS = [
  "approved",
  "rejected",
  "cancelled",
  "modified",
  "driver_assigned",
  "driver_reassigned",
  "van_assigned",
  "van_reassigned",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  modified: "Changed trip details",
  driver_assigned: "Assigned driver",
  driver_reassigned: "Reassigned driver",
  van_assigned: "Assigned van",
  van_reassigned: "Reassigned van",
};

export interface AuditEntry {
  id: string;
  /** ISO instant. Rendered in Manila by the view. */
  at: string;
  action: AuditAction;
  actorName: string;
  /** The trip the action was taken on. */
  reference: string;
  requestor: string;
  site: SiteLocation;
  /** Manila wall-clock date of the trip, for identifying it at a glance. */
  startDate: string;
  purpose: string;
  /** A rejection reason or cancellation remark. */
  remark: string | null;
  changes: ParsedChanges;
}

/**
 * Where the next page starts. Both halves are needed: `created_at` ties are
 * routine, since every event written in one transaction shares a timestamp.
 * Shared by both logs — the keyset shape does not depend on what is paged.
 */
export interface AuditCursor {
  at: string;
  id: string;
}

export interface RosterAuditEntry {
  id: string;
  /** ISO instant. Rendered in Manila by the view. */
  at: string;
  target: RosterTarget;
  eventType: RosterEventType;
  actorName: string;
  /**
   * The target's CURRENT name, resolved by join at read time — deliberately
   * different from `AuditEntry`, which snapshots display strings at write
   * time. A roster entry describes an object that still exists and is best
   * identified by what it is called now; `changes` still carries the
   * historical before/after values.
   */
  subject: string;
  changes: ParsedChanges;
}
