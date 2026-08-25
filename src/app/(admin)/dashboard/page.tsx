import { redirect } from "next/navigation";
import { DashboardView } from "@/components/admin/dashboard/dashboard-view";
import { AdminShell } from "@/components/shells/admin-shell";
import { getSessionUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { listReservations } from "@/modules/reservations/repo";

export default async function AdminDashboardPage() {
  // Deliberately per-page, not hoisted into a `(admin)` layout: a layout does
  // not re-execute on client-side navigation between sibling routes, so a
  // layout-only check would be a fail-open the moment a second admin page is
  // added. Repeat this check on every admin page instead of DRYing it up.
  const user = await getSessionUser();
  if (user === null) redirect("/admin/login");
  if (user.role !== "admin_support") redirect("/not-authorized?reason=role");

  const rows = await listReservations(getDb(), { all: true });

  return (
    <AdminShell active="dashboard" userName={user.name}>
      <DashboardView rows={rows} />
    </AdminShell>
  );
}
