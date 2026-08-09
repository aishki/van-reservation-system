import Link from "next/link";
import { EM_DASH, formatInstant } from "@/lib/tz";
import type { BookingDraft } from "@/modules/reservations/draft";

interface BookingDoneProps {
  draft: BookingDraft;
  /** One per trip — a multi-trip draft is several rows, each with its own. */
  references: string[];
  submittedAt: Date;
  onBookAnother: () => void;
}

/**
 * The confirmation screen.
 *
 * `submittedAt` is a real instant, so it goes through `formatInstant` and renders
 * in Asia/Manila regardless of where the browser thinks it is — the one date on
 * this screen that is NOT a plain calendar value.
 *
 * The heading is an `h1` and receives focus on mount, because arriving here is a
 * view change with no navigation: without moving focus, a screen-reader user who
 * pressed "Submit request" is left on a button that no longer exists and hears
 * nothing about the outcome.
 */
export function BookingDone({
  draft,
  references,
  submittedAt,
  onBookAnother,
}: BookingDoneProps) {
  const tripCount = draft.trips.length;
  const noun = draft.mode === "standby" ? "date" : "trip";
  const body =
    draft.mode === "standby"
      ? `Your standby van request for ${tripCount} ${noun}${tripCount === 1 ? "" : "s"} in ${draft.site || EM_DASH} is pending approval. Your Tower Head and Admin Support both need to sign off. A confirmation goes to your registered email.`
      : `Your pickup / drop-off request for ${tripCount} ${noun}${tripCount === 1 ? "" : "s"} in ${draft.site || EM_DASH} is pending approval. A confirmation goes to your registered email.`;

  return (
    <div className="relative min-h-full px-3 py-5 md:px-6 md:py-11">
      <div
        aria-hidden="true"
        className="done-weave pointer-events-none absolute inset-0 opacity-55"
      />
      <div className="relative mx-auto max-w-[1000px] rounded-card border border-gray-6 bg-background px-5 py-10 text-center shadow-[0_18px_50px_color-mix(in_srgb,var(--color-navy)_7%,transparent)] md:px-14 md:py-[72px]">
        <span
          aria-hidden="true"
          className="mx-auto mb-[22px] flex size-16 items-center justify-center rounded-pill bg-success-tint text-[1.75rem] font-bold text-success"
        >
          ✓
        </span>
        <h1
          tabIndex={-1}
          ref={(node) => node?.focus()}
          className="mb-4 text-[2.25rem] leading-[1.1] font-semibold tracking-[-0.025em] text-brand focus-visible:outline-none md:text-5xl"
        >
          Request Sent!
        </h1>
        <p className="mx-auto mb-3 max-w-[640px] text-body text-pretty text-gray-1">
          {body}
        </p>
        <p className="mx-auto mb-8 max-w-[640px] text-sm text-pretty text-gray-2">
          {/* Plural because each trip is its own row with its own reference —
              quoting only the first would leave the others unfindable. */}
          {references.length === 1 ? "Reference" : "References"}{" "}
          {references.join(", ") || EM_DASH} · submitted{" "}
          {formatInstant(submittedAt) ?? EM_DASH}
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            href="/manage"
            className="rounded-pill border-[1.5px] border-brand bg-background px-[34px] py-[15px] text-body font-semibold text-brand transition-colors hover:bg-brand-tint/40"
          >
            Manage Bookings
          </Link>
          <button
            type="button"
            onClick={onBookAnother}
            className="cursor-pointer rounded-pill bg-brand px-[34px] py-[15px] text-body font-semibold text-primary-foreground transition-[filter] hover:brightness-110"
          >
            Book another request
          </button>
        </div>
      </div>
    </div>
  );
}
