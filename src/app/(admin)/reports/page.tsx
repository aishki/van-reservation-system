import { redirect } from "next/navigation";
import { ReportForm } from "@/components/admin/reports/report-form";
import { AdminShell } from "@/components/shells/admin-shell";
import { getSessionUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { listReservations } from "@/modules/reservations/repo";

export default async function ReportsPage() {
  // Deliberately per-page, not hoisted into an `(admin)` layout: a layout does
  // not re-execute on client-side navigation between sibling routes, so a
  // layout-only check would be a fail-open. Repeat it on every admin page.
  const user = await getSessionUser();
  if (user === null) redirect("/admin/login");
  if (user.role !== "admin_support") redirect("/not-authorized?reason=role");

  const rows = await listReservations(getDb(), { all: true });

  return (
    <AdminShell active="reports" userName={user.name}>
      <ReportForm rows={rows} />
    </AdminShell>
  );
}
