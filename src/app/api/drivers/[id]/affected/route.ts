import { errorResponse } from "@/lib/api-error";
import { todayInManila } from "@/lib/tz";
import { requireAdmin } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { affectedTrips } from "@/modules/roster/conflicts";

/**
 * Upcoming trips a deactivation would leave with this driver still assigned —
 * the warning `DeactivateDialog` shows before the admin confirms.
 *
 * `today` is computed HERE, server-side, never accepted from the client: a
 * caller who could name their own "today" could make an already-run trip
 * disappear from the warning.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return errorResponse(admin.error, "Admin access required.");
  }
  const { id } = await params;
  return Response.json(
    await affectedTrips(getDb(), "driver", id, todayInManila()),
  );
}
