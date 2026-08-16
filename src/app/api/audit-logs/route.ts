import { errorResponse } from "@/lib/api-error";
import { isSuperAdmin } from "@/modules/admins/repo";
import { listAuditEntries } from "@/modules/audit/repo";
import { listRosterEvents } from "@/modules/audit/roster-repo";
import { auditQueryFrom, auditQuerySchema } from "@/modules/audit/wire";
import { requireAdmin } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";

/**
 * The admin action log — two sources, reservations and roster, behind one
 * endpoint. `source` picks which; see `audit-view.tsx` for why they are not
 * merged into one page.
 *
 * `requireAdmin` rather than `requireUser`: `/api/*` sits outside the middleware
 * matcher (the edge runtime cannot load Kysely), so this handler owns the role
 * check — the same reason the reservation routes do.
 *
 * The log's scope — admin actors only — is enforced in `listAuditEntries` and
 * `listRosterEvents`, not here, so no query parameter can widen it.
 *
 * The roster log's SECOND scope is the whitelist-manager capability. Its
 * `admin_whitelist` rows carry an admin's name in `subject` and their email,
 * Domain ID and `super_admin` state in `changes` — everything `/api/admins` and
 * `/roster` withhold from a plain `admin_support` user, who would otherwise
 * read it all back out of the log. Resolved HERE, by the same database read
 * those two gate on, and handed to the repo as a boolean: only the route can
 * see the session, and only a boolean the request cannot spell is a scope.
 */
export async function GET(req: Request) {
  const user = await requireAdmin();
  if (!user.ok) {
    return errorResponse(
      user.error,
      "Sign in as Admin Support to view the audit log.",
    );
  }

  const query = auditQuerySchema.safeParse(
    auditQueryFrom(new URL(req.url).searchParams),
  );
  if (!query.success) {
    return errorResponse(
      "VALIDATION_FAILED",
      "That audit-log filter is not valid.",
    );
  }

  const db = getDb();
  if (query.data.source === "roster") {
    const includeAdminTargets = await isSuperAdmin(db, {
      domainId: user.value.domainId,
      email: user.value.email,
    });
    return Response.json(
      await listRosterEvents(db, query.data, { includeAdminTargets }),
    );
  }
  return Response.json(await listAuditEntries(db, query.data));
}
