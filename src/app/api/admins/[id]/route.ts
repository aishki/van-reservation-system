import { errorResponse } from "@/lib/api-error";
import type { Result } from "@/lib/result";
import { setAdminActive, updateAdmin } from "@/modules/admins/repo";
import { getDb } from "@/modules/db/client";
import type { RosterFailure } from "@/modules/roster/types";
import { activeSchema, adminPatchSchema } from "@/modules/roster/wire";
import { gate } from "../gate";

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
  const gated = await gate();
  if (!gated.ok) return gated.error;

  // Read once: both schemas are tried against the same body below.
  const body = await req.json().catch(() => null);
  const { id } = await params;
  const actor = {
    userId: gated.value.userId,
    domainId: gated.value.domainId,
    email: gated.value.email,
    name: gated.value.name,
    role: gated.value.role,
  };

  // Activation is its OWN request shape, not a patch field — `active` is not
  // part of `adminPatchSchema` at all. Tried first, and both schemas are
  // `.strict()`, so a body mixing the two matches NEITHER and is refused rather
  // than half-applied.
  const activation = activeSchema.safeParse(body);
  if (activation.success) {
    return respond(
      await setAdminActive(getDb(), id, activation.data.active, actor),
    );
  }

  const parsed = adminPatchSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_FAILED", "That change is not valid.", {
      issues: parsed.error.flatten().fieldErrors,
    });
  }
  return respond(await updateAdmin(getDb(), id, parsed.data, actor));
}
