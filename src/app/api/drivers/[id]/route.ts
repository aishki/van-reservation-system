import { errorResponse } from "@/lib/api-error";
import type { Result } from "@/lib/result";
import { requireAdmin } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { setDriverActive, updateDriver } from "@/modules/drivers/repo";
import type { RosterFailure } from "@/modules/roster/types";
import { activeSchema, driverPatchSchema } from "@/modules/roster/wire";

function respond<T>(result: Result<T, RosterFailure>): Response {
  if (!result.ok) {
    return errorResponse(result.error.code, result.error.message, {
      field: result.error.field,
    });
  }
  return Response.json(result.value);
}

/**
 * One PATCH handles both a field edit and an activation change — splitting
 * them into two routes would put one resource's state behind two URLs.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return errorResponse(admin.error, "Admin access required.");
  }

  // Read once: both schemas are tried against the same body below.
  const body = await req.json().catch(() => null);
  const { id } = await params;
  const actor = {
    userId: admin.value.userId,
    domainId: admin.value.domainId,
    email: admin.value.email,
    name: admin.value.name,
    role: admin.value.role,
  };

  // Activation is its OWN request shape, not a patch field — `active` is not
  // part of `driverPatchSchema` at all. Tried first, and both schemas are
  // `.strict()`, so a body mixing the two matches NEITHER and is refused rather
  // than half-applied. The log records activation as `deactivated`/
  // `reactivated`, which is what "who took this driver off the roster" needs.
  const activation = activeSchema.safeParse(body);
  if (activation.success) {
    return respond(
      await setDriverActive(getDb(), id, activation.data.active, actor),
    );
  }

  const parsed = driverPatchSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_FAILED", "That change is not valid.", {
      issues: parsed.error.flatten().fieldErrors,
    });
  }
  return respond(await updateDriver(getDb(), id, parsed.data, actor));
}
