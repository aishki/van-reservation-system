import { after } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { env } from "@/lib/env";
import { requireUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { dispatchOutbox } from "@/modules/email/dispatch";
import { selectMailTransport } from "@/modules/email/select-transport";
import { cancelInputSchema, parseJsonBody } from "@/modules/reservations/wire";
import { cancelReservation } from "@/modules/reservations/write";

/**
 * Cancels a request.
 *
 * A route of its own rather than a `PATCH` on the reservation, because this is
 * the one write a requestor may perform on a submitted booking and its
 * authorization is a different question: `requireUser` here, then ownership
 * inside `cancelReservation`, against the session — never against the row menu
 * that decided whether to offer the action. A non-owner gets the same 404 as an
 * unknown reference, so this endpoint reveals nothing `GET` would not.
 *
 * `POST` and not `DELETE`: nothing is deleted. The row survives with a
 * `Cancelled` status, its passengers, and a `cancelled` event naming who ended
 * it — the history an approved-then-cancelled trip has to keep.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (!user.ok) {
    return errorResponse(user.error, "Sign in to cancel a request.");
  }

  // A body is optional: the manage table's confirm dialog collects no reason.
  const input = (await parseJsonBody(req, cancelInputSchema)) ?? { reason: "" };

  const { id } = await params;
  const cancelled = await cancelReservation(
    getDb(),
    user.value,
    id,
    input.reason,
  );
  if (!cancelled.ok) {
    const { code, message, details } = cancelled.error;
    return errorResponse(code, message, details);
  }

  dispatchAfterResponse();

  return new Response(null, { status: 204 });
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
