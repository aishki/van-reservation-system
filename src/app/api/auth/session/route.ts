import { errorResponse } from "@/lib/api-error";
import { requireUser } from "@/modules/auth/service";

export async function GET() {
  const result = await requireUser();
  if (!result.ok) {
    return errorResponse(result.error, "No active session.");
  }
  return Response.json({ user: result.value });
}
