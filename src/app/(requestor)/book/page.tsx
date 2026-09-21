import { redirect } from "next/navigation";
import { BookingWizard } from "@/components/requestor/wizard/booking-wizard";
import { RequestorShell } from "@/components/shells/requestor-shell";
import { getSessionUser } from "@/modules/auth/service";
import { getDb } from "@/modules/db/client";
import { draftFromDetail } from "@/modules/reservations/draft";
import { getReservationDetail } from "@/modules/reservations/repo";
import { isRequestorEditable, isRideMode } from "@/modules/reservations/types";

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; edit?: string }>;
}) {
  // Per-page, never in a layout — see the comment in `(requestor)/page.tsx`.
  const user = await getSessionUser();
  if (user === null) redirect("/login");

  const { mode, edit } = await searchParams;

  // `?edit=<reference>` re-opens a saved request in the wizard, filled in.
  // Loaded here, on the server, so the form is never rendered blank and then
  // populated: the wizard seeds its state once, from what it is handed.
  //
  // A reference that is not the caller's, does not exist, or is no longer
  // pending all go back to the list — the same answer for each, so this page is
  // no more an existence oracle than `GET /api/reservations/[id]`. The Save
  // endpoint re-checks all three; this is only so nobody fills in a form the
  // server is about to refuse.
  if (edit !== undefined) {
    const found = await getReservationDetail(getDb(), edit);
    if (
      found === null ||
      found.requestorUserId !== user.userId ||
      !isRequestorEditable(found.detail.status)
    ) {
      redirect("/manage");
    }

    return (
      <RequestorShell active="manage" className="bg-brand-wash">
        <BookingWizard
          mode={found.detail.mode}
          name={user.name}
          email={user.email}
          edit={{
            reference: found.detail.id,
            version: found.detail.version,
            draft: draftFromDetail(found.detail),
          }}
        />
      </RequestorShell>
    );
  }

  // Step 1 always precedes step 2, so arriving without a valid mode means a
  // hand-edited or stale URL. Send it back to the picker rather than guessing a
  // mode — the two flows collect materially different fields.
  if (!isRideMode(mode)) redirect("/?view=choose");

  return (
    <RequestorShell active="book" className="bg-brand-wash">
      {/* Name and email come from the session, not the form. They render into
          read-only inputs so the requestor can check them, and on submit the
          server must take them from the session again rather than from the
          request body — a client that can edit its own identity is not one. */}
      <BookingWizard mode={mode} name={user.name} email={user.email} />
    </RequestorShell>
  );
}
