import { z } from "zod";
import { type ErrorCode, errorResponse } from "@/lib/api-error";
import { env } from "@/lib/env";
import { selectAuthProvider } from "@/modules/auth/select-provider";
import { requireUser } from "@/modules/auth/service";

const body = z.object({ domainId: z.string().trim().min(1) });

const DEFAULT_ERROR = "Couldn't check that Domain ID right now. Try again.";

const LOOKUP_ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  RATE_LIMITED: "Too many lookups. Please wait a moment and try again.",
  SERVICE_UNAVAILABLE: DEFAULT_ERROR,
};

/**
 * Passenger-name lookup backing the booking wizard's passenger rows.
 *
 * Session-gated, unlike `/api/auth/verify-domain`: that route runs pre-login
 * and is boolean-only by design (enumeration trade-off), while this one
 * discloses a NAME — so it is reachable only by a signed-in user, and the
 * pre-login route must never grow a name field.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user.ok) {
    return errorResponse(user.error, "Sign in to look up passengers.");
  }

  const provider = selectAuthProvider(env());
  if (provider === null) {
    return errorResponse("SERVICE_UNAVAILABLE", DEFAULT_ERROR);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse("VALIDATION_FAILED", "Enter a Domain ID.");
  }
  const parsed = body.safeParse(raw);
  if (!parsed.success) {
    return errorResponse("VALIDATION_FAILED", "Enter a Domain ID.");
  }

  const result = await provider.lookupName(parsed.data.domainId);
  if (!result.ok) {
    return errorResponse(
      result.error,
      LOOKUP_ERROR_MESSAGES[result.error] ?? DEFAULT_ERROR,
    );
  }

  return Response.json(
    result.value === null
      ? { found: false }
      : { found: true, name: result.value.name },
  );
}
