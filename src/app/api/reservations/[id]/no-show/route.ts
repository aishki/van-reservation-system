import { after } from "next/server";
import { errorResponse } from "@/lib/api-error";
import { env } from "@/lib/env";
import { requireAdmin } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { dispatchOutbox } from "@/modules/email/dispatch";
import { selectMailTransport } from "@/modules/email/select-transport";
import { markNoShow, revertNoShow } from "@/modules/reservations/write";

/**
 * Marks or reverts a no-show — a route of its own for the same reason
 * `/cancel` is: it is one specific transition, not a field on the decide
 * drawer's save. `requireAdmin`, not `requireUser`: unlike a cancellation,
 * this is a determination about what happened on the day, made by Admin
 * Support, never by the requestor.
 *
 * `POST` marks; `DELETE` reverts back to Approved. Neither deletes a row —
 * `DELETE` here names "undo the no-show", the same non-literal use `DELETE`
 * gets nowhere else in this API, chosen because a body-less verb pair reads
 * better than a `POST` with an `{ action: "revert" }` payload.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return errorResponse(
      admin.error,
      "Only Admin Support can mark a no-show.",
    );
  }

  const { id } = await params;
  const marked = await markNoShow(getDb(), admin.value, id);
  if (!marked.ok) {
    const { code, message, details } = marked.error;
    return errorResponse(code, message, details);
  }

  dispatchAfterResponse();

  return new Response(null, { status: 204 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return errorResponse(
      admin.error,
      "Only Admin Support can revert a no-show.",
    );
  }

  const { id } = await params;
  const reverted = await revertNoShow(getDb(), admin.value, id);
  if (!reverted.ok) {
    const { code, message, details } = reverted.error;
    return errorResponse(code, message, details);
  }

  dispatchAfterResponse();

  return new Response(null, { status: 204 });
}

/**
 * Delivers whatever the write just queued, once the response is flushed.
 *
 * `after()` runs post-response, so the admin never waits on SES. A failure
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
