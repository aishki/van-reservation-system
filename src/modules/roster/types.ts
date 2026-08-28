import type { ErrorCode } from "@/lib/api-error";
import type { AppRole } from "@/modules/auth/roles";

/**
 * The three tables the roster surface edits.
 *
 * Spelled as the table names rather than a friendlier vocabulary, because this
 * value is written to `roster_events.target_table` and read back by a query
 * that joins on it — a translation layer would be one more place for the two
 * to drift.
 */
export const ROSTER_TARGETS = ["drivers", "vans", "admin_whitelist"] as const;
export type RosterTarget = (typeof ROSTER_TARGETS)[number];

export const ROSTER_EVENT_TYPES = [
  "created",
  "updated",
  "deactivated",
  "reactivated",
] as const;
export type RosterEventType = (typeof ROSTER_EVENT_TYPES)[number];

export const ROSTER_EVENT_LABELS: Record<RosterEventType, string> = {
  created: "Added",
  updated: "Edited",
  deactivated: "Deactivated",
  reactivated: "Reactivated",
};

/**
 * Who acted. Passed in by the route from the session — this module never reads
 * the session itself, matching how `reservations/write.ts` takes its actor.
 */
export interface RosterActor {
  /** `users.id`, for `roster_events.actor_user_id`. Nullable: the column is. */
  userId: string | null;
  /**
   * The actor's Domain ID.
   *
   * REQUIRED, and the only safe way to ask "is this the actor's own whitelist
   * row?". `admin_whitelist.id` and `users.id` are DIFFERENT tables, so
   * comparing them is always false — which would make the self-lockout
   * guardrails silently never fire. Domain ID is also the stable key: an email
   * can be reassigned, a Domain ID cannot, which is why `matchWhitelist` prefers
   * it too.
   */
  domainId: string;
  /** Fallback identity for a whitelist row carrying no Domain ID. */
  email: string | null;
  name: string;
  role: AppRole;
}

/**
 * A refused roster write.
 *
 * `field` names the input to attach the message to, so a duplicate plate lands
 * on the Plate box rather than in a toast that leaves the user hunting. Absent
 * for failures that belong to the whole form.
 */
export interface RosterFailure {
  code: ErrorCode;
  message: string;
  field?: string;
}

export const ROSTER_MESSAGES = {
  notFound: "That roster entry no longer exists.",
  duplicateVanNumber: "Another van already uses that number.",
  duplicatePlate: "Another van already uses that plate.",
  duplicateEmail: "Another admin already uses that email address.",
  duplicateDomainId: "Another admin already uses that Domain ID.",
  selfDemote: "You cannot remove your own whitelist access.",
  selfDeactivate: "You cannot deactivate your own account.",
  lastSuperAdmin:
    "At least one person must be able to manage the whitelist. Grant access to someone else first.",
  identityRequired: "Give an email address or a Domain ID.",
} as const;
