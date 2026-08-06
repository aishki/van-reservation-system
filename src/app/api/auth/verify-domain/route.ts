import { z } from "zod";
import { type ErrorCode, errorResponse } from "@/lib/api-error";
import { env } from "@/lib/env";
import { selectAuthProvider } from "@/modules/auth/select-provider";

const body = z.object({ domainId: z.string().trim().min(1) });

const DEFAULT_ERROR = "Couldn't check that Domain ID right now. Try again.";

// Only the codes verifyDomain can emit. `Partial` keeps the broad ErrorCode
// union safe to index with a generic fallback.
const VERIFY_ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  SERVICE_UNAVAILABLE:
    "Sign-in is temporarily unavailable. Please try again shortly.",
};

/**
 * Pre-login Domain ID existence check backing the login form's two-step reveal.
 * Intentionally unauthenticated — it runs before sign-in — so it discloses only
 * a boolean and never distinguishes a non-existent ID via an error status: a
 * missing ID is a normal `200 { exists: false }`. See the note on the
 * enumeration trade-off in `CgsAuthProvider`.
 */
export async function POST(req: Request) {
  const config = env();

  const provider = selectAuthProvider(config);
  if (provider === null) {
    return errorResponse(
      "SERVICE_UNAVAILABLE",
      VERIFY_ERROR_MESSAGES.SERVICE_UNAVAILABLE ?? DEFAULT_ERROR,
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse("VALIDATION_FAILED", "Enter your Domain ID.");
  }
  const parsed = body.safeParse(raw);
  if (!parsed.success) {
    return errorResponse("VALIDATION_FAILED", "Enter your Domain ID.");
  }

  const result = await provider.verifyDomain(parsed.data.domainId);
  if (!result.ok) {
    const message = VERIFY_ERROR_MESSAGES[result.error] ?? DEFAULT_ERROR;
    return errorResponse(result.error, message);
  }

  return Response.json({ exists: result.value.exists });
}
