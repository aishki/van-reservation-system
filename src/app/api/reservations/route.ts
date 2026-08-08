import { after } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { env } from "@/lib/env";
import { requireUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { dispatchOutbox } from "@/modules/email/dispatch";
import { selectMailTransport } from "@/modules/email/select-transport";
import { listReservations } from "@/modules/reservations/repo";
import { bookingDraftSchema, parseJsonBody } from "@/modules/reservations/wire";
import { submitBooking } from "@/modules/reservations/write";

export async function GET() {
  const user = await requireUser();
  if (!user.ok) {
    return errorResponse(user.error, "Sign in to view reservations.");
  }

  // Scoping is decided HERE, server-side, from the session — never by the
  // client. An associate gets only their own rows.
  const scope =
    user.value.role === "admin_support"
      ? ({ all: true } as const)
      : { requestorUserId: user.value.userId };

  return Response.json(await listReservations(getDb(), scope));
}

/**
 * Submits a booking: the wizard's `BookingDraft`, in, one reference per trip,
 * out.
 *
 * Any signed-in user may book — an Admin Support member is also an associate
 * who needs a van, and the row records whoever's session sent it. The
 * requestor's identity is taken from that session and never from the body, so
 * the endpoint cannot be used to book in someone else's name.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user.ok) {
    return errorResponse(user.error, "Sign in to submit a request.");
  }

  const draft = await parseJsonBody(req, bookingDraftSchema);
  if (draft === null) {
    return errorResponse("VALIDATION_FAILED", "Send a booking draft as JSON.");
  }

  const submittedAt = new Date();
  const created = await submitBooking(getDb(), user.value, draft, submittedAt);
  if (!created.ok) {
    const { code, message, details } = created.error;
    return errorResponse(code, message, details);
  }

  dispatchAfterResponse();

  return Response.json(
    { references: created.value, submittedAt: submittedAt.toISOString() },
    { status: 201 },
  );
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
