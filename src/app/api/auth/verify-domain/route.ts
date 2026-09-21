import { z } from "zod";
import { type ErrorCode, errorResponse } from "@/lib/api-error";
import { env } from "@/lib/env";
import { selectAuthProvider } from "@/modules/auth/select-provider";
import { isAdminDomainId, parseLoginPortal } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";

// `portal` is optional and degrades to the associate door, as at login.
const body = z.object({
  domainId: z.string().trim().min(1),
  portal: z.unknown().optional(),
});

const DEFAULT_ERROR = "Couldn't check that Domain ID right now. Try again.";

// Only the codes verifyDomain can emit. `Partial` keeps the broad ErrorCode
// union safe to index with a generic fallback.
const VERIFY_ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  SERVICE_UNAVAILABLE:
    "Sign-in is temporarily unavailable. Please try again shortly.",
};

/**
 * Pre-login Domain ID check backing the login form's two-step reveal.
 * Intentionally unauthenticated — it runs before sign-in — so it discloses only
 * booleans and never distinguishes a refusal via an error status: a missing ID
 * is a normal `200 { exists: false }`. See the note on the enumeration
 * trade-off in `CgsAuthProvider`.
 *
 * `eligible` answers "may this ID be asked for a password on THIS page". On the
 * associate page it equals `exists`. On the admin page it is also false for an
 * ID that is not on the admin whitelist, so the password step is never offered.
 * That makes admin-list membership answerable to an anonymous caller who can
 * guess an ID — accepted, and no worse than what `/api/auth/login` says about a
 * correct password at the wrong door. It is a convenience, not the control:
 * `authenticate` refuses a non-admin at the admin door whatever this said.
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

  const { exists } = result.value;
  const adminDoor = parseLoginPortal(parsed.data.portal) === "admin";
  const eligible =
    exists &&
    (!adminDoor || (await isAdminDomainId(getDb(), parsed.data.domainId)));

  return Response.json({ exists, eligible });
}
