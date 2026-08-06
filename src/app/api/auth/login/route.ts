import { cookies } from "next/headers";
import { type ErrorCode, errorResponse } from "@/lib/api-error";
import { env } from "@/lib/env";
import { selectAuthProvider } from "@/modules/auth/select-provider";
import {
  authenticate,
  type LoginPortal,
  parseLoginPortal,
} from "@/modules/auth/service";
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/modules/auth/session";
import { getDb } from "@/modules/db/client";

const DEFAULT_LOGIN_ERROR =
  "Sign-in failed. Check your credentials and try again.";

// Keyed by the codes `authenticate` can actually emit. Typed `Partial` so the
// broad ErrorCode union is safe to index and an unmapped code falls back to the
// generic (non-disclosing) message rather than tripping tsc.
const LOGIN_ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  NOT_AUTHENTICATED: DEFAULT_LOGIN_ERROR,
  RATE_LIMITED:
    "Too many sign-in attempts. Please wait a moment and try again.",
  SERVICE_UNAVAILABLE:
    "Sign-in is temporarily unavailable. Please try again shortly.",
  // Only reachable from the admin door: the credential was accepted and the
  // Domain ID is simply not on the admin whitelist. Says so, and points at the
  // door that will work — unlike the other three, this is not a secret, and a
  // generic "sign-in failed" would send someone to reset a password that was
  // never wrong.
  FORBIDDEN:
    "This Domain ID isn't approved for Admin Support. Sign in on the associate page instead.",
};

/**
 * Which sign-in page sent this request.
 *
 * Read from a CLONE of the request, because `provider.identify` consumes the
 * body next and a Request body can only be read once. An absent, malformed, or
 * unrecognised value resolves to the associate door — see `parseLoginPortal`.
 */
async function portalOf(req: Request): Promise<LoginPortal> {
  try {
    const body: unknown = await req.clone().json();
    if (typeof body !== "object" || body === null) return "requestor";
    return parseLoginPortal((body as { portal?: unknown }).portal);
  } catch {
    return "requestor";
  }
}

export async function POST(req: Request) {
  const config = env();

  const provider = selectAuthProvider(config);
  if (provider === null) {
    // A server-side configuration gap, not a credential failure. The message
    // does not disclose which provider is unwired to an unauthenticated caller.
    return errorResponse(
      "SERVICE_UNAVAILABLE",
      LOGIN_ERROR_MESSAGES.SERVICE_UNAVAILABLE ?? DEFAULT_LOGIN_ERROR,
    );
  }

  const result = await authenticate(
    { db: getDb(), provider },
    req,
    await portalOf(req),
  );

  if (!result.ok) {
    const message = LOGIN_ERROR_MESSAGES[result.error] ?? DEFAULT_LOGIN_ERROR;
    return errorResponse(result.error, message);
  }

  const token = await createSessionToken(result.value, config.SESSION_SECRET);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return Response.json({
    user: result.value,
    redirectTo: result.value.role === "admin_support" ? "/dashboard" : "/",
  });
}
