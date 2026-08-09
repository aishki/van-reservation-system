"use client";

import { STEP_HEADING } from "@/components/requestor/wizard/wizard-theme";
import {
  EM_DASH,
  formatPlainDate,
  formatPlainDateTime,
  formatPlainTime,
} from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { BookingDraft, TripDraft } from "@/modules/reservations/draft";
import { RIDE_MODE_LABELS } from "@/modules/reservations/types";

interface StepReviewProps {
  draft: BookingDraft;
  name: string;
  email: string;
  submitError?: string;
  /** Jumps back to step 3 with the trip in question on screen. */
  onEditTrips: () => void;
}

/**
 * Step 4 — everything the requestor is about to submit, in one read.
 *
 * Every date and time goes through `lib/tz`. Nothing here formats a value
 * itself: the pickup date is a plain calendar date and must not be routed
 * through a `Date`, or a requestor whose laptop is set to a zone west of Manila
 * sees the day before the one they picked. `tz.test.ts`'s drift guard enforces
 * that this file cannot reach for `toLocaleDateString`.
 *
 * Laid out as description lists rather than the design's paired `<p>` elements,
 * so each value is programmatically associated with its own label — a screen
 * reader reading this as sixteen loose paragraphs cannot tell which value
 * belongs to which field.
 */
export function StepReview({
  draft,
  name,
  email,
  submitError,
  onEditTrips,
}: StepReviewProps) {
  const standby = draft.mode === "standby";

  return (
    <>
      <h2 className={STEP_HEADING}>Review &amp; Submit</h2>
      <p className="mt-1.5 mb-[26px] max-w-[58ch] text-body text-gray-1">
        Double-check everything below before sending your request for approval.
      </p>

      <div className="flex flex-col gap-5">
        <ReviewCard title="Ride & Site">
          <Row label="Mode" value={RIDE_MODE_LABELS[draft.mode].title} />
          <Row label="Site Location" value={draft.site || EM_DASH} />
        </ReviewCard>

        <ReviewCard title="Requestor">
          <Row label="Name" value={name} />
          <Row label="Email" value={email} />
          <Row label="Mobile Number" value={draft.mobile || EM_DASH} />
        </ReviewCard>

        {draft.trips.map((trip, index) => (
          <ReviewCard
            // biome-ignore lint/suspicious/noArrayIndexKey: read-only summary cards with no inputs or local state
            key={index}
            title={`${standby ? "Date" : "Trip"} ${index + 1}`}
            action={
              <button
                type="button"
                onClick={onEditTrips}
                className="ml-auto cursor-pointer text-sm font-semibold text-primary underline hover:text-brand focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Edit
                <span className="sr-only">
                  {` ${standby ? "date" : "trip"} ${index + 1}`}
                </span>
              </button>
            }
            footer={passengerSummary(trip)}
          >
            {standby ? standbyRows(trip) : pickupRows(trip)}
          </ReviewCard>
        ))}
      </div>

      {submitError !== undefined && (
        <p
          role="alert"
          className="mt-[18px] rounded-field bg-error-tint px-[18px] py-3.5 text-sm text-error"
        >
          {submitError}
        </p>
      )}
    </>
  );
}

function pickupRows(trip: TripDraft) {
  return (
    <>
      <Row label="Purpose" value={trip.purpose || EM_DASH} />
      <Row label="Details" value={trip.details || EM_DASH} />
      <Row
        label="Pickup"
        value={formatPlainDateTime(trip.pickupDate, trip.pickupTime) ?? EM_DASH}
      />
      <Row label="Pickup Point" value={trip.pickupPoint || EM_DASH} />
      <Row label="Drop-off Point" value={trip.dropoffPoint || EM_DASH} />
    </>
  );
}

function standbyRows(trip: TripDraft) {
  const start = formatPlainDate(trip.startDate);
  const end = formatPlainDate(trip.endDate);
  const from = formatPlainTime(trip.startTime);
  const to = formatPlainTime(trip.endTime);

  return (
    <>
      <Row label="Purpose" value={trip.purpose || EM_DASH} />
      <Row label="Details" value={trip.details || EM_DASH} />
      <Row label="Approving Tower Head" value={trip.towerHead || EM_DASH} />
      <Row
        label="Standby Window"
        value={start === null || end === null ? EM_DASH : `${start} → ${end}`}
      />
      <Row
        label="Hours"
        value={from === null || to === null ? EM_DASH : `${from} – ${to}`}
      />
      <Row label="Reporting Point" value={trip.pickupPoint || EM_DASH} />
    </>
  );
}

function passengerSummary(trip: TripDraft): string {
  const count = trip.passengers.length;
  const listed = trip.passengers
    .map((p) => `${p.name || EM_DASH} (${p.domainId || EM_DASH})`)
    .join(" · ");
  return `${count} passenger${count === 1 ? "" : "s"}: ${listed}`;
}

function ReviewCard({
  title,
  action,
  footer,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-gray-6 px-6 py-6 md:px-7">
      <div className="mb-[18px] flex items-center gap-3">
        <h3 className="text-lg font-semibold text-brand">{title}</h3>
        {action}
      </div>
      <dl className="grid grid-cols-1 gap-[18px] md:grid-cols-2 md:gap-x-6">
        {children}
      </dl>
      {footer !== undefined && (
        <p className="mt-[18px] text-sm text-gray-2">{footer}</p>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={cn("mb-1 text-body text-gray-3")}>{label}</dt>
      <dd className="text-body text-gray-1">{value}</dd>
    </div>
  );
}
