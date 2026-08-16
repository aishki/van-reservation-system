import { redirect } from "next/navigation";
import { AuditView } from "@/components/admin/audit/audit-view";
import { AdminShell } from "@/components/shells/admin-shell";
import { listAuditEntries } from "@/modules/audit/repo";
import { getSessionUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";

export default async function AuditLogsPage() {
  // Deliberately per-page, not hoisted into an `(admin)` layout: a layout does
  // not re-execute on client-side navigation between sibling routes, so a
  // layout-only check would be a fail-open. Repeat it on every admin page.
  const user = await getSessionUser();
  if (user === null) redirect("/admin/login");
  if (user.role !== "admin_support") redirect("/not-authorized?reason=role");

  // The blank filter's first page, matching the view's own initial state — it
  // seeds `initialData` under that exact key and nothing else.
  const initial = await listAuditEntries(getDb(), {
    action: null,
    actor: null,
    from: null,
    to: null,
    limit: 50,
    cursor: null,
  });

  return (
    <AdminShell active="audit-logs" userName={user.name}>
      <AuditView initial={initial} />
    </AdminShell>
  );
}
