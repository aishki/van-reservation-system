import type { Kysely } from "kysely";
import { cookies } from "next/headers";
import type { ErrorCode } from "@/lib/api-error";
import { env } from "@/lib/env";
import { err, ok, type Result } from "@/lib/result";
import type { AuthProvider } from "@/modules/auth/provider";
import { listActiveWhitelist, upsertUser } from "@/modules/auth/repo";
import {
  type AppRole,
  resolveRole,
  resolveSuperAdmin,
} from "@/modules/auth/roles";
import {
  readSessionToken,
  SESSION_COOKIE,
  type SessionUser,
} from "@/modules/auth/session";
import type { DB } from "@/modules/db/types";

export interface AuthDeps {
  db: Kysely<DB>;
  provider: AuthProvider;
}

/**
 * Which sign-in page a credential arrived at.
 *
 * The admin whitelist is consulted for `admin` ONLY. One Domain ID may belong
 * to someone who both books vans and approves them, and which of those they are
 * doing right now is answered by the door they walked through — not by a table.
 * Before this existed, a whitelisted associate signing in at `/login` was
 * silently handed an admin session and landed on the dashboard.
 */
export const LOGIN_PORTALS = ["requestor", "admin"] as const;
export type LoginPortal = (typeof LOGIN_PORTALS)[number];

/**
 * Anything that is not the exact string `"admin"` is the associate door.
 *
 * Deliberately not a zod enum that rejects: an omitted or misspelled portal
 * must degrade to the LESS privileged reading, never to a 422 that a caller
 * could avoid by omitting the field.
 */
export function parseLoginPortal(value: unknown): LoginPortal {
  return value === "admin" ? "admin" : "requestor";
}

/**
 * Identify, resolve the role for this portal, then create or refresh the local
 * record.
 *
 * There is no separate eligibility allowlist for associates: the CGS directory
 * authenticates only active Carelon employees, so a successful `identify` is
 * itself the FR-2 check. The only allowlist left is `admin_whitelist`, which
 * decides the ROLE (`resolveRole`) rather than admission — and now only at the
 * admin door.
 *
 * Two roles come out of this function and they are not the same thing:
 *
 * - `capability` — what the whitelist says this person COULD be. Written to
 *   `users.role`, so that column records a standing fact rather than flapping
 *   with whichever page was last used. NOTHING authorizes off it; every check
 *   reads the session's role, which is why storing the wider value is a record
 *   and not a grant.
 * - `role` — what they ARE for this session, which is `associate` at the
 *   requestor door no matter what the whitelist says.
 */
export async function authenticate(
  deps: AuthDeps,
  req: Request,
  portal: LoginPortal,
): Promise<Result<SessionUser, ErrorCode>> {
  const identified = await deps.provider.identify(req);
  // The provider's failure codes (NOT_AUTHENTICATED / SERVICE_UNAVAILABLE /
  // RATE_LIMITED) are a subset of ErrorCode, so they propagate unchanged and
  // the route can map each to its own status and message.
  if (!identified.ok) return err(identified.error);
  const identity = identified.value;

  const whitelist = await listActiveWhitelist(deps.db);
  const capability = resolveRole(identity, whitelist);

  // Refused BEFORE `upsertUser`, so a sign-in that produced no session leaves
  // no `last_login_at` claiming otherwise. The credential was valid; the door
  // was wrong.
  if (portal === "admin" && capability !== "admin_support") {
    return err("FORBIDDEN");
  }
  // The guard above is what proves the `admin_support` branch: reaching it
  // means the whitelist already matched.
  const role: AppRole = portal === "admin" ? "admin_support" : "associate";

  const user = await upsertUser(deps.db, identity, capability);

  return ok({
    userId: user.id,
    domainId: user.domain_id,
    name: user.name,
    email: user.email,
    role,
    superAdmin: resolveSuperAdmin(identity, whitelist),
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSessionToken(token, env().SESSION_SECRET);
}

/**
 * The route-handler authorization primitive. `/api/*` is excluded from the
 * middleware matcher (the edge runtime cannot load Kysely), so every route
 * handler must call one of these itself rather than re-deriving the check.
 */
export async function requireUser(): Promise<Result<SessionUser, ErrorCode>> {
  const user = await getSessionUser();
  if (user === null) return err("NOT_AUTHENTICATED");
  return ok(user);
}

/**
 * Allowlist-shaped by design: it admits only the literal `"admin_support"`
 * role and denies everything else, including any role added to APP_ROLES
 * later. A "deny if role is associate" check would instead fail OPEN the day
 * a third role is introduced — this is exactly the shape of defect this slice's
 * review caught three times in ad-hoc route-handler checks.
 */
export async function requireAdmin(): Promise<Result<SessionUser, ErrorCode>> {
  const user = await getSessionUser();
  if (user === null) return err("NOT_AUTHENTICATED");
  if (user.role === "admin_support") return ok(user);
  return err("FORBIDDEN");
}
