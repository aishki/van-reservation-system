import { errorResponse } from "@/lib/api-error";
import { err, ok, type Result } from "@/lib/result";
import { isSuperAdmin } from "@/modules/admins/repo";
import { requireAdmin } from "@/modules/auth/service";
import type { SessionUser } from "@/modules/auth/session";
import { getDb } from "@/modules/db/client";

/**
 * The whitelist-management gate.
 *
 * `requireAdmin` establishes the role; `isSuperAdmin` re-reads the DATABASE for
 * the capability, because a capability carried in a signed cookie outlives its
 * revocation — demote someone and their cookie still claims it until they log
 * out. The database read is the boundary.
 *
 * The session's `superAdmin` flag is deliberately NOT consulted: it is
 * cosmetic, and it lags a GRANT exactly as it lags a revocation. Requiring it
 * here gave a freshly-promoted holder the Admins tab (`roster/page.tsx` reads
 * the database) and a 403 on every write behind it, for the life of the
 * cookie. One authority in both directions.
 *
 * Shared by both `route.ts` and `[id]/route.ts` — every `/api/admins` entry
 * point, not just one, so a change here (a third check, a different message,
 * a fix to identity matching) reaches both at once instead of needing to be
 * mirrored by hand.
 */
export async function gate(): Promise<Result<SessionUser, Response>> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return err(
      errorResponse(admin.error, "Only whitelist managers can do that."),
    );
  }
  // The full identity, not just the Domain ID: `isSuperAdmin` delegates to the
  // matcher LOGIN uses (Domain ID first, email fallback), so that "can sign in
  // as this row" and "may manage the whitelist" cannot diverge. Passing one half
  // reopened a lockout — clearing the last holder's Domain ID left the holder
  // count above zero while the capability was unreachable for everyone.
  if (
    !(await isSuperAdmin(getDb(), {
      domainId: admin.value.domainId,
      email: admin.value.email,
    }))
  ) {
    return err(
      errorResponse("FORBIDDEN", "Your whitelist access has been removed."),
    );
  }
  return ok(admin.value);
}
