import { errorResponse } from "@/lib/api-error";
import { requireUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { getFieldHistory } from "@/modules/reservations/repo";

/**
 * The booking wizard's combobox suggestions: the signed-in requestor's own
 * past values for its free-text fields.
 *
 * Deliberately no admin/"all" branch, unlike `GET /api/reservations` — this is
 * a personal autocomplete convenience, not a management view, so it is always
 * scoped to the caller's own `userId` regardless of role. An Admin Support
 * member booking a van for themselves gets their own history, never anyone
 * else's.
 */
export async function GET() {
  const user = await requireUser();
  if (!user.ok) {
    return errorResponse(user.error, "Sign in to view your field history.");
  }

  return Response.json(await getFieldHistory(getDb(), user.value.userId));
}
