import { redirect } from "next/navigation";
import { BookingWizard } from "@/components/requestor/wizard/booking-wizard";
import { RequestorShell } from "@/components/shells/requestor-shell";
import { getSessionUser } from "@/modules/auth/service";
import { isRideMode } from "@/modules/reservations/types";

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  // Per-page, never in a layout — see the comment in `(requestor)/page.tsx`.
  const user = await getSessionUser();
  if (user === null) redirect("/login");

  const { mode } = await searchParams;
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
