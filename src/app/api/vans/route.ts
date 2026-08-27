import { errorResponse } from "@/lib/api-error";
import { requireAdmin } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { vanCreateSchema } from "@/modules/roster/wire";
import { createVan, listVans } from "@/modules/vans/repo";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return errorResponse(admin.error, "Admin access required.");
  }

  return Response.json(await listVans(getDb()));
}

/**
 * The ACTOR comes from the session, never from the body. A client that could
 * name its own actor could forge who made a change in an append-only log.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return errorResponse(admin.error, "Admin access required.");
  }

  const parsed = vanCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse("VALIDATION_FAILED", "That van is not valid.", {
      issues: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await createVan(getDb(), parsed.data, {
    userId: admin.value.userId,
    domainId: admin.value.domainId,
    email: admin.value.email,
    name: admin.value.name,
    role: admin.value.role,
  });

  if (!result.ok) {
    return errorResponse(result.error.code, result.error.message, {
      field: result.error.field,
    });
  }
  return Response.json(result.value, { status: 201 });
}
