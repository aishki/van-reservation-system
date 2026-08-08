import { comparePlainDates, comparePlainTimes } from "@/lib/tz";
import { isTripPurpose } from "@/modules/reservations/reference";
import type { RideMode, SiteLocation } from "@/modules/reservations/types";

/**
 * The in-progress booking a requestor is filling in, and the rules that decide
 * whether a step may be left.
 *
 * Pure — no React, no DOM, no fetch. The wizard is mostly validation logic, and
 * keeping it here means the rules can be tested directly instead of through
 * eight rendered inputs. This is also the shape `/api/reservations` will accept,
 * so the server can re-run `validateStep` on submit rather than trusting the
 * client: none of these checks are security boundaries, but all of them are
 * data-integrity ones, and a client-only check is not a check.
 */

export interface PassengerDraft {
  /** Exactly 7 characters when valid. Upper-cased as the user types. */
  domainId: string;
  name: string;
}

export interface TripDraft {
  purpose: string;
  /**
   * Details for Event Purpose. Required for every purpose, not only "Others" —
   * the client's admin wants context on every booking, so this is not gated on
   * which purpose was picked.
   */
  details: string;
  /** Required for standby only — the cost is charged to this Tower Head. */
  towerHead: string;
  passengers: PassengerDraft[];

  /** Pickup mode only. */
  pickupDate: string;
  pickupTime: string;
  dropoffPoint: string;

  /**
   * Where the van collects (pickup mode) or waits (standby mode). One field
   * serving both because it is one concept; the design relabels it "Reporting
   * Point" for standby rather than collecting a second value.
   */
  pickupPoint: string;

  /** Standby mode only. */
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
}

export interface BookingDraft {
  mode: RideMode;
  /** Empty until the requestor picks one — `""` is not a valid site. */
  site: SiteLocation | "";
  mobile: string;
  trips: TripDraft[];
}

/** Schedule fields, per mode. Used to drive per-input error borders. */
export const PICKUP_SCHEDULE_FIELDS = [
  "pickupDate",
  "pickupTime",
  "pickupPoint",
  "dropoffPoint",
] as const;

export const STANDBY_SCHEDULE_FIELDS = [
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "pickupPoint",
] as const;

export type ScheduleField =
  | (typeof PICKUP_SCHEDULE_FIELDS)[number]
  | (typeof STANDBY_SCHEDULE_FIELDS)[number];

export function scheduleFieldsFor(mode: RideMode): readonly ScheduleField[] {
  return mode === "standby" ? STANDBY_SCHEDULE_FIELDS : PICKUP_SCHEDULE_FIELDS;
}

export interface TripErrors {
  purpose?: string;
  details?: string;
  towerHead?: string;
  /** One message for the passenger block as a whole. */
  passengers?: string;
  /** Per-row flags, so the offending input gets the red border, not all of them. */
  passengerRows: { domainId: boolean; name: boolean }[];
  /** Required schedule fields left blank. */
  missing: Partial<Record<ScheduleField, true>>;
  /** One message for the schedule block as a whole. */
  schedule?: string;
}

export interface DraftErrors {
  site?: string;
  mobile?: string;
  trips: TripErrors[];
}

export const MESSAGES = {
  siteRequired: "Choose a site before continuing.",
  mobileRequired: "Mobile number is required.",
  mobileFormat: "Enter an 11-digit number starting with 09.",
  purposeRequired: "Select a purpose.",
  purposeUnknown: "Choose a purpose from the list.",
  detailsRequired: "Add details for this trip's purpose.",
  towerRequired: "Select an approving Tower Head.",
  passengersIncomplete:
    "Every passenger needs a 7-character Domain ID and a name.",
  scheduleIncomplete: "Fill in every required schedule field.",
  endDateBeforeStart: "End date cannot be before the start date.",
  endTimeNotAfterStart:
    "End time must be after the start time when the window is a single day.",
} as const;

export function blankPassenger(): PassengerDraft {
  return { domainId: "", name: "" };
}

export function blankTrip(): TripDraft {
  return {
    purpose: "",
    details: "",
    towerHead: "",
    passengers: [blankPassenger()],
    pickupDate: "",
    pickupTime: "",
    pickupPoint: "",
    dropoffPoint: "",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
  };
}

export function blankDraft(mode: RideMode): BookingDraft {
  return { mode, site: "", mobile: "", trips: [blankTrip()] };
}

/** A Domain ID is valid at exactly 7 characters, ignoring surrounding space. */
export function isCompleteDomainId(value: string): boolean {
  return value.trim().length === 7;
}

/**
 * Digits only, for validating and storing a mobile number. The input accepts
 * the spacing in its own placeholder (`09XX XXX XXXX`), so the raw value cannot
 * be pattern-matched directly.
 */
export function normalizeMobile(value: string): string {
  return value.replace(/\D/g, "");
}

/** 11 digits beginning `09` — the Philippine mobile format. */
export function isValidMobile(value: string): boolean {
  return /^09\d{9}$/.test(normalizeMobile(value));
}

function emptyTripErrors(passengerCount: number): TripErrors {
  return {
    passengerRows: Array.from({ length: passengerCount }, () => ({
      domainId: false,
      name: false,
    })),
    missing: {},
  };
}

/**
 * Which wizard step a set of rules belongs to. Step 1 (choose ride) is answered
 * before the draft exists, and step 4 re-runs both 2 and 3 — a requestor can
 * reach Review and then edit a field back to empty, and submitting whatever is
 * on screen at that moment is how a half-filled request reaches Admin Support.
 */
export type WizardStep = 2 | 3 | 4;

export function validateStep(
  draft: BookingDraft,
  step: WizardStep,
): DraftErrors {
  const errors: DraftErrors = {
    trips: draft.trips.map((trip) => emptyTripErrors(trip.passengers.length)),
  };

  if (step === 2 || step === 4) validateDetails(draft, errors);
  if (step === 3 || step === 4) validateTrips(draft, errors);

  return errors;
}

function validateDetails(draft: BookingDraft, errors: DraftErrors): void {
  if (draft.site === "") errors.site = MESSAGES.siteRequired;

  const digits = normalizeMobile(draft.mobile);
  if (digits === "") errors.mobile = MESSAGES.mobileRequired;
  else if (!isValidMobile(digits)) errors.mobile = MESSAGES.mobileFormat;
}

function validateTrips(draft: BookingDraft, errors: DraftErrors): void {
  const standby = draft.mode === "standby";

  draft.trips.forEach((trip, index) => {
    const tripErrors = errors.trips[index];

    const purpose = trip.purpose.trim();
    if (purpose === "") tripErrors.purpose = MESSAGES.purposeRequired;
    else if (!isTripPurpose(purpose))
      tripErrors.purpose = MESSAGES.purposeUnknown;

    // `.trim()` matters here too: Task 14's `btrim` CHECK constraint rejects a
    // whitespace-only value, and letting it pass here would turn that into a
    // 500 instead of this field error.
    if (trip.details.trim() === "")
      tripErrors.details = MESSAGES.detailsRequired;

    if (standby && trip.towerHead.trim() === "")
      tripErrors.towerHead = MESSAGES.towerRequired;

    trip.passengers.forEach((passenger, row) => {
      const badId = !isCompleteDomainId(passenger.domainId);
      const badName = passenger.name.trim() === "";
      tripErrors.passengerRows[row] = { domainId: badId, name: badName };
      if (badId || badName)
        tripErrors.passengers = MESSAGES.passengersIncomplete;
    });

    // `.trim()` matters: the design document checks falsiness, so a
    // whitespace-only pickup point passes its validation and reaches Admin
    // Support as a blank destination.
    for (const field of scheduleFieldsFor(draft.mode)) {
      if (trip[field].trim() === "") tripErrors.missing[field] = true;
    }
    if (Object.keys(tripErrors.missing).length > 0)
      tripErrors.schedule = MESSAGES.scheduleIncomplete;

    if (!standby) return;

    const dateOrder = comparePlainDates(trip.startDate, trip.endDate);
    if (dateOrder !== null && dateOrder > 0) {
      tripErrors.schedule = MESSAGES.endDateBeforeStart;
      tripErrors.missing.startDate = true;
      tripErrors.missing.endDate = true;
      return;
    }

    // Not in the design document, which validates neither this nor the date
    // order beyond a single comparison: on a same-day window it happily accepts
    // 17:00 → 09:00, an eight-hour negative booking that a driver is then
    // dispatched against. Only checked when the window IS one day, because
    // across two days an end time earlier in the clock is normal.
    if (dateOrder === 0) {
      const timeOrder = comparePlainTimes(trip.startTime, trip.endTime);
      if (timeOrder !== null && timeOrder >= 0) {
        tripErrors.schedule = MESSAGES.endTimeNotAfterStart;
        tripErrors.missing.startTime = true;
        tripErrors.missing.endTime = true;
      }
    }
  });
}

/** True when nothing is wrong and the step may be left. */
export function isDraftStepValid(errors: DraftErrors): boolean {
  if (errors.site !== undefined || errors.mobile !== undefined) return false;
  return errors.trips.every(
    (trip) =>
      trip.purpose === undefined &&
      trip.details === undefined &&
      trip.towerHead === undefined &&
      trip.passengers === undefined &&
      trip.schedule === undefined &&
      Object.keys(trip.missing).length === 0,
  );
}
