import { errorResponse } from "@/lib/api-error";
import { todayInManila } from "@/lib/tz";
import { requireAdmin } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { affectedTrips } from "@/modules/roster/conflicts";

/**
 * Upcoming trips a deactivation would leave with this van still assigned —
 * the warning `DeactivateDialog` shows before the admin confirms. See the
 * driver equivalent for why `today` is computed server-side.
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
    await affectedTrips(getDb(), "van", id, todayInManila()),
  );
}
