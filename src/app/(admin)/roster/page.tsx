import { redirect } from "next/navigation";
import { RosterView } from "@/components/admin/roster/roster-view";
import { AdminShell } from "@/components/shells/admin-shell";
import { todayInManila } from "@/lib/tz";
import { isSuperAdmin, listAdmins } from "@/modules/admins/repo";
import { getSessionUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { listDrivers } from "@/modules/drivers/repo";
import { listVans } from "@/modules/vans/repo";

export default async function RosterPage() {
  // Deliberately per-page, not hoisted into an `(admin)` layout: a layout does
  // not re-execute on client-side navigation between sibling routes, so a
  // layout-only check would be a fail-open. Repeat it on every admin page.
  const user = await getSessionUser();
  if (user === null) redirect("/admin/login");
  if (user.role !== "admin_support") redirect("/not-authorized?reason=role");

  const db = getDb();
  const [drivers, vans] = await Promise.all([listDrivers(db), listVans(db)]);

  // NOT `user.superAdmin`. That flag comes from the signed cookie and is
  // documented as cosmetic: it outlives its own revocation, so gating a data
  // fetch on it would hand the whole whitelist to someone whose access was
  // removed this morning. `/api/admins` re-reads the database for the same
  // reason — see `src/app/api/admins/gate.ts` — and this page must agree with
  // it rather than trust the cookie the route refuses to trust.
  const holder = await isSuperAdmin(db, {
    domainId: user.domainId,
    email: user.email,
  });

  // Only fetched for a holder. The list names who has admin, which is not
  // information a plain admin_support user needs, and not sending it is cheaper
  // than sending it and hiding it in the client.
  const admins = holder ? await listAdmins(db) : [];

  return (
    <AdminShell active="roster" userName={user.name}>
      <RosterView
        drivers={drivers}
        vans={vans}
        admins={admins}
        adminName={user.name}
        superAdmin={holder}
        today={todayInManila()}
      />
    </AdminShell>
  );
}
