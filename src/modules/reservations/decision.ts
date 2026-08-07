/**
 * The rules governing an Admin Support decision on a request.
 *
 * Pure — no React, no fetch. These are the same checks
 * `POST /api/reservations/[id]/approve` must re-run server-side: a client-only
 * check is not a check, and every rule below is also a database constraint, so
 * skipping them here does not permit bad data, it produces a 500 where a field
 * error belonged.
 */

import type { DriverInput, VanInput } from "@/modules/reservations/types";

export const DECISIONS = ["approve", "reject"] as const;
export type Decision = (typeof DECISIONS)[number];

export const DECISION_LABELS: Record<Decision, string> = {
  approve: "Approve",
  reject: "Reject",
};

export interface DecisionDraft {
  /** Null while the admin is only editing fields, which is a legal save. */
  decision: Decision | null;
  rejectionReason: string;
  /** The driver being assigned, or "" for none. */
  driverName: string;
  /** The van being assigned, or "" for none. */
  vanName: string;
}

export interface DecisionErrors {
  rejectionReason?: string;
  driverName?: string;
  van?: string;
}

export const DECISION_MESSAGES = {
  reasonRequired: "A reason is required before rejecting.",
  driverRequired: "Assign a driver before approving this request.",
  vanRequired: "Assign a van before approving this request.",
  reassignNothing: "Change the driver or the van before reassigning.",
} as const;

/**
 * Every rule comes straight from the schema:
 *
 *   CHECK (status <> 'approved' OR assigned_driver_id IS NOT NULL
 *                               OR rental_driver_name IS NOT NULL)
 *   CHECK (status <> 'approved' OR assigned_van_id    IS NOT NULL
 *                               OR rental_plate       IS NOT NULL)
 *   CHECK (status <> 'rejected' OR rejection_remark   IS NOT NULL)
 *
 * Van and driver are separate rules because they are separate constraints: a
 * trip can hold one without the other right up to approval.
 *
 * The driver rule is NOT in the design document, whose drawer lets an admin
 * press Approve with the Driver field showing its "Not assigned yet"
 * placeholder. That request cannot be written — the constraint refuses it — so
 * the design's flow ends in a failed save with nothing pointing at the field
 * that caused it. FR-13 requires the driver at approval, so it is asked for
 * here, before the request is sent.
 *
 * `.trim()` on both: a reason of `"   "` satisfies a falsiness check and
 * reaches the requestor's rejection email as a blank explanation.
 */
export function validateDecision(draft: DecisionDraft): DecisionErrors {
  const errors: DecisionErrors = {};

  if (draft.decision === "reject" && draft.rejectionReason.trim() === "") {
    errors.rejectionReason = DECISION_MESSAGES.reasonRequired;
  }
  if (draft.decision === "approve" && draft.driverName.trim() === "") {
    errors.driverName = DECISION_MESSAGES.driverRequired;
  }
  if (draft.decision === "approve" && draft.vanName.trim() === "") {
    errors.van = DECISION_MESSAGES.vanRequired;
  }

  return errors;
}

/**
 * The same rules, against the shape the API carries.
 *
 * The drawer validates by NAME, because a name is what its selects show; `PATCH
 * /api/reservations/[id]` carries a roster id or a typed-in rental. Adapting
 * rather than restating keeps one copy of every rule and every message, so a
 * rejection from the server lands on the same field, with the same words, as one
 * the drawer raised itself.
 */
export function validateDecisionInput(input: {
  decision: Decision | null;
  rejectionReason: string;
  driver: DriverInput | null;
  van: VanInput | null;
}): DecisionErrors {
  return validateDecision({
    decision: input.decision,
    rejectionReason: input.rejectionReason,
    // Either source counts as assigned; the rule is about presence, and the
    // CHECK constraints it mirrors are satisfied by either column. `null` means
    // "leave this side unchanged", which on an unassigned request is nothing.
    driverName: input.driver === null ? "" : "assigned",
    vanName: input.van === null ? "" : "assigned",
  });
}

export function isDecisionValid(errors: DecisionErrors): boolean {
  return (
    errors.rejectionReason === undefined &&
    errors.driverName === undefined &&
    errors.van === undefined
  );
}

/** The save button's label, which names the consequence rather than "Save". */
export function saveLabelFor(
  decision: Decision | null,
  mode: "decide" | "reassign" = "decide",
): string {
  if (mode === "reassign") return "Reassign & Save";
  if (decision === "approve") return "Approve & Save";
  if (decision === "reject") return "Reject & Save";
  return "Save changes";
}
