import { after } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { env } from "@/lib/env";
import { requireAdmin, requireUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { dispatchOutbox } from "@/modules/email/dispatch";
import { selectMailTransport } from "@/modules/email/select-transport";
import { getReservationDetail } from "@/modules/reservations/repo";
import { requestorFacingStatus } from "@/modules/reservations/types";
import {
  decisionInputSchema,
  parseJsonBody,
} from "@/modules/reservations/wire";
import { decideReservation } from "@/modules/reservations/write";

const NOT_FOUND_MESSAGE = "Reservation not found.";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (!user.ok) {
    return errorResponse(user.error, "Sign in to view reservations.");
  }

  const { id } = await params;
  const found = await getReservationDetail(getDb(), id);
  if (found === null) {
    return errorResponse("NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  // Identical body to a real miss: an associate must not be able to probe
  // which references exist (no existence oracle).
  const isOwner = found.requestorUserId === user.value.userId;
  if (user.value.role !== "admin_support" && !isOwner) {
    return errorResponse("NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  // Reaching here as a non-admin means the caller is the owner. The repo cannot
  // apply this itself: it hands back `requestorUserId` for the comparison above,
  // so the audience is only known once that comparison has run.
  if (user.value.role !== "admin_support") {
    return Response.json({
      ...found.detail,
      status: requestorFacingStatus(found.detail.status),
    });
  }

  return Response.json(found.detail);
}

/**
 * The Trip Details drawer's save: approve, reject, edit the trip, or any
 * combination — one endpoint because the drawer has one save button, and a
 * decision of `null` (fields edited, nothing decided) is a legal save that no
 * `/approve` or `/reject` route could name.
 *
 * `requireAdmin` rather than `requireUser`: `/api/*` sits outside the middleware
 * matcher (the edge runtime cannot load Kysely), so this handler owns the role
 * check. It is allowlist-shaped — only `admin_support` passes — so a role added
 * later is denied by default rather than admitted.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return errorResponse(
      admin.error,
      "Only Admin Support can review requests.",
    );
  }

  const input = await parseJsonBody(req, decisionInputSchema);
  if (input === null) {
    return errorResponse("VALIDATION_FAILED", "Send a decision as JSON.");
  }

  const { id } = await params;
  const decided = await decideReservation(getDb(), admin.value, id, input);
  if (!decided.ok) {
    const { code, message, details } = decided.error;
    return errorResponse(code, message, details);
  }

  dispatchAfterResponse();

  return Response.json(decided.value);
}

/**
 * Delivers whatever the write just queued, once the response is flushed.
 *
 * `after()` runs post-response, so the requestor never waits on SES. A failure
 * here is already recorded on the outbox row, and the sweeper
 * (`/api/internal/dispatch-outbox`) picks up anything this misses.
 */
function dispatchAfterResponse(): void {
  after(async () => {
    const transport = selectMailTransport(env());
    if (transport === null) return;
    await dispatchOutbox(getDb(), transport);
  });
}
