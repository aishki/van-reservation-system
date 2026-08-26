import { redirect } from "next/navigation";
import { CalendarView } from "@/components/admin/calendar/calendar-view";
import { AdminShell } from "@/components/shells/admin-shell";
import { todayInManila } from "@/lib/tz";
import { getSessionUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { listReservations } from "@/modules/reservations/repo";

export default async function CalendarPage() {
  // Deliberately per-page, not hoisted into an `(admin)` layout: a layout does
  // not re-execute on client-side navigation between sibling routes, so a
  // layout-only check would be a fail-open. Repeat it on every admin page.
  const user = await getSessionUser();
  if (user === null) redirect("/admin/login");
  if (user.role !== "admin_support") redirect("/not-authorized?reason=role");

  // Whole-set fetch; the spec's date-ranged /api/reservations/calendar is a
  // later optimization once row counts make slicing a week in the browser slow.
  const rows = await listReservations(getDb(), { all: true });

  // Computed once, on the server, and passed down: the calendar opens on the
  // week containing today, and reading the clock during render on both sides
  // would let them disagree across Manila midnight — landing the server and the
  // client on different weeks.
  return (
    <AdminShell active="calendar" userName={user.name}>
      <CalendarView rows={rows} today={todayInManila()} adminName={user.name} />
    </AdminShell>
  );
}
