import { redirect } from "next/navigation";
import { ManageView } from "@/components/requestor/manage/manage-view";
import { RequestorShell } from "@/components/shells/requestor-shell";
import { todayInManila } from "@/lib/tz";
import { getSessionUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { listReservations } from "@/modules/reservations/repo";

export default async function ManagePage() {
  // Per-page, never in a layout — see the comment in `(requestor)/page.tsx`.
  const user = await getSessionUser();
  if (user === null) redirect("/login");

  // Scoped server-side to the signed-in user — the manage list is the one
  // surface where ownership IS the query.
  const rows = await listReservations(getDb(), {
    requestorUserId: user.userId,
  });

  // Computed once, on the server, and passed down: the upcoming/past split
  // depends on it, and reading the clock during render on both sides would let
  // them disagree across Manila midnight.
  return (
    <RequestorShell active="manage" className="bg-gray-5">
      <ManageView initialRows={rows} today={todayInManila()} />
    </RequestorShell>
  );
}
