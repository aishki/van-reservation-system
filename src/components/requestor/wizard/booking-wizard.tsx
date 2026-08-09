"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookingDone } from "@/components/requestor/wizard/booking-done";
import { StepDetails } from "@/components/requestor/wizard/step-details";
import { StepReview } from "@/components/requestor/wizard/step-review";
import { StepTrips } from "@/components/requestor/wizard/step-trips";
import { WizardStepper } from "@/components/requestor/wizard/wizard-stepper";
import {
  WIZARD_BACK,
  WIZARD_NEXT,
} from "@/components/requestor/wizard/wizard-theme";
import { ApiError, apiFetch } from "@/lib/api-fetcher";
import {
  type BookingDraft,
  blankDraft,
  blankPassenger,
  blankTrip,
  type DraftErrors,
  isDraftStepValid,
  type PassengerDraft,
  type TripDraft,
  validateStep,
  type WizardStep,
} from "@/modules/reservations/draft";
import type { RideMode, SiteLocation } from "@/modules/reservations/types";

interface BookingWizardProps {
  mode: RideMode;
  /** From the session. Read-only in the form and never trusted from the client. */
  name: string;
  email: string;
}

/** One reference per trip in the draft — the wizard can submit several at once. */
interface SubmitResponse {
  references: string[];
  submittedAt: string;
}

interface Submission {
  references: string[];
  submittedAt: Date;
}

/**
 * Steps 2 to 4 of the booking flow, plus the confirmation screen.
 *
 * ── Error timing ─────────────────────────────────────────────────────────────
 * Errors are computed on every render but only DISPLAYED once the requestor has
 * tried to leave the step (`showErrors`). That means no field is marked wrong
 * before it has been filled in, and once a step has been rejected, fixing a
 * field clears its message immediately rather than on the next Continue.
 *
 * The design document instead clears errors one at a time through a
 * `clearError(key)` call wired into every single `onChange`. That works until a
 * handler is added without one — and the field then stays red after being
 * corrected, which reads as the form being broken.
 *
 * ── Step is state, not a URL ──────────────────────────────────────────────────
 * Consistent with the ride picker living in the hero. Putting the step in the
 * URL would make it linkable, but the draft is client state, so a deep link to
 * step 3 would land on an empty form with a filled-in progress rail. Back from
 * step 2 leaves the wizard entirely, which is why it says "Back to ride".
 */
export function BookingWizard({ mode, name, email }: BookingWizardProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<BookingDraft>(() => blankDraft(mode));
  const [step, setStep] = useState<WizardStep>(2);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const [submission, setSubmission] = useState<Submission | null>(null);

  const liveErrors = validateStep(draft, step);
  const errors: DraftErrors = showErrors ? liveErrors : emptyErrors(draft);

  const patchTrip = (index: number, patch: Partial<TripDraft>) =>
    setDraft((current) => ({
      ...current,
      trips: current.trips.map((trip, i) =>
        i === index ? { ...trip, ...patch } : trip,
      ),
    }));

  const patchPassenger = (
    tripIndex: number,
    passengerIndex: number,
    patch: Partial<PassengerDraft>,
  ) =>
    setDraft((current) => ({
      ...current,
      trips: current.trips.map((trip, i) =>
        i === tripIndex
          ? {
              ...trip,
              passengers: trip.passengers.map((passenger, j) =>
                j === passengerIndex ? { ...passenger, ...patch } : passenger,
              ),
            }
          : trip,
      ),
    }));

  const goToStep = (next: WizardStep) => {
    setStep(next);
    setShowErrors(false);
    // The card is up to two viewports tall on step 3; without this the next
    // step opens scrolled to wherever the previous one was.
    window.scrollTo({ top: 0 });
  };

  const onNext = () => {
    if (!isDraftStepValid(liveErrors)) {
      setShowErrors(true);
      return;
    }
    if (step === 2) return goToStep(3);
    if (step === 3) return goToStep(4);
    void submit();
  };

  const onBack = () => {
    if (step === 3) return goToStep(2);
    if (step === 4) return goToStep(3);
    router.push("/?view=choose");
  };

  /**
   * `POST /api/reservations`, with `draft` as the body — which is why
   * `BookingDraft` was defined in the domain module rather than here.
   *
   * The endpoint re-runs `validateStep` server-side, so `onNext` having already
   * checked is a courtesy: a rule that only ever runs in the browser is not a
   * rule. Both the references and the submitted instant come back from the
   * server, because both are its to decide — the reference is drawn from a
   * per-year sequence no client can guess, and the instant is the one the row
   * was actually stamped with.
   */
  const submit = async () => {
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const created = await apiFetch<SubmitResponse>("/api/reservations", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      setSubmission({
        references: created.references,
        submittedAt: new Date(created.submittedAt),
      });
    } catch (error) {
      // The server's own words when it gave any — a 422 here means the client
      // and server disagree about the draft, and its message says how.
      setSubmitError(
        error instanceof ApiError
          ? error.message
          : "Could not submit your request. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submission !== null) {
    return (
      <BookingDone
        draft={draft}
        references={submission.references}
        submittedAt={submission.submittedAt}
        onBookAnother={() => {
          setDraft(blankDraft(mode));
          setSubmission(null);
          goToStep(2);
        }}
      />
    );
  }

  return (
    <div className="relative px-3 py-5 md:px-6 md:py-11">
      {/* Map watermark. Decorative and behind everything, so it never intercepts
          a pointer event on the card above it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[url('/assets/map-bg.png')] bg-cover bg-top bg-no-repeat opacity-55"
      />

      <div className="relative mx-auto max-w-[1000px] rounded-card border border-gray-6 bg-background px-[18px] py-6 shadow-[0_18px_50px_color-mix(in_srgb,var(--color-navy)_7%,transparent)] md:px-14 md:py-12">
        <WizardStepper current={step} />

        {step === 2 && (
          <StepDetails
            site={draft.site}
            mobile={draft.mobile}
            name={name}
            email={email}
            errors={errors}
            onSite={(site: SiteLocation) =>
              setDraft((current) => ({ ...current, site }))
            }
            onMobile={(mobile) =>
              setDraft((current) => ({ ...current, mobile }))
            }
          />
        )}

        {step === 3 && (
          <StepTrips
            draft={draft}
            errors={errors}
            onTrip={patchTrip}
            onAddTrip={() =>
              setDraft((current) => ({
                ...current,
                trips: [...current.trips, blankTrip()],
              }))
            }
            onRemoveTrip={(index) =>
              setDraft((current) =>
                current.trips.length === 1
                  ? current
                  : {
                      ...current,
                      trips: current.trips.filter((_, i) => i !== index),
                    },
              )
            }
            onPassenger={patchPassenger}
            onAddPassenger={(tripIndex) =>
              patchTrip(tripIndex, {
                passengers: [
                  ...draft.trips[tripIndex].passengers,
                  blankPassenger(),
                ],
              })
            }
            onRemovePassenger={(tripIndex, passengerIndex) => {
              const passengers = draft.trips[tripIndex].passengers;
              if (passengers.length === 1) return;
              patchTrip(tripIndex, {
                passengers: passengers.filter((_, j) => j !== passengerIndex),
              });
            }}
          />
        )}

        {step === 4 && (
          <StepReview
            draft={draft}
            name={name}
            email={email}
            submitError={submitError}
            onEditTrips={() => goToStep(3)}
          />
        )}

        <div className="mt-9 flex items-center gap-3.5 border-t border-gray-6 pt-[26px]">
          <button type="button" onClick={onBack} className={WIZARD_BACK}>
            {step === 2 ? "Back to ride" : "Back"}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={submitting}
            className={WIZARD_NEXT}
          >
            {submitting && (
              <span
                aria-hidden="true"
                className="size-[15px] animate-spin rounded-pill border-2 border-white/40 border-t-white"
              />
            )}
            {step === 4
              ? submitting
                ? "Submitting…"
                : "Submit request"
              : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Error shape with nothing set — used before the requestor has tried to advance. */
function emptyErrors(draft: BookingDraft): DraftErrors {
  return {
    trips: draft.trips.map((trip) => ({
      passengerRows: trip.passengers.map(() => ({
        domainId: false,
        name: false,
      })),
      missing: {},
    })),
  };
}
