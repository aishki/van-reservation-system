import { redirect } from "next/navigation";
import { WorkloadView } from "@/components/admin/drivers/workload-view";
import { AdminShell } from "@/components/shells/admin-shell";
import { todayInManila } from "@/lib/tz";
import { getSessionUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { listDrivers } from "@/modules/drivers/repo";
import { listReservations } from "@/modules/reservations/repo";

export default async function DriverWorkloadPage() {
  // Deliberately per-page, not hoisted into an `(admin)` layout: a layout does
  // not re-execute on client-side navigation between sibling routes, so a
  // layout-only check would be a fail-open. Repeat it on every admin page.
  const user = await getSessionUser();
  if (user === null) redirect("/admin/login");
  if (user.role !== "admin_support") redirect("/not-authorized?reason=role");

  const drivers = await listDrivers(getDb());
  const rows = await listReservations(getDb(), { all: true });

  return (
    <AdminShell active="drivers" userName={user.name}>
      <WorkloadView drivers={drivers} rows={rows} today={todayInManila()} />
    </AdminShell>
  );
}
