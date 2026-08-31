import { errorResponse } from "@/lib/api-error";
import { createAdmin, listAdmins } from "@/modules/admins/repo";
import { getDb } from "@/modules/db/client";
import { adminCreateSchema } from "@/modules/roster/wire";
import { gate } from "./gate";

/**
 * Gated like the writes below: the list itself names who holds admin, which is
 * not information a plain `admin_support` user needs.
 */
export async function GET() {
  const gated = await gate();
  if (!gated.ok) return gated.error;

  return Response.json(await listAdmins(getDb()));
}

/**
 * The ACTOR comes from the session, never from the body. A client that could
 * name its own actor could forge who made a change in an append-only log.
 */
export async function POST(req: Request) {
  const gated = await gate();
  if (!gated.ok) return gated.error;

  const parsed = adminCreateSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return errorResponse("VALIDATION_FAILED", "That admin is not valid.", {
      issues: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await createAdmin(getDb(), parsed.data, {
    userId: gated.value.userId,
    domainId: gated.value.domainId,
    email: gated.value.email,
    name: gated.value.name,
    role: gated.value.role,
  });

  if (!result.ok) {
    return errorResponse(result.error.code, result.error.message, {
      field: result.error.field,
    });
  }
  return Response.json(result.value, { status: 201 });
}
