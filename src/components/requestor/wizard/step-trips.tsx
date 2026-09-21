"use client";

import { Copy, Trash2 } from "lucide-react";
import { useId } from "react";
import { Hint } from "@/components/common/hint";
import { PassengerList } from "@/components/requestor/wizard/passenger-list";
import { WizardComboInput } from "@/components/requestor/wizard/wizard-combo-input";
import { WizardSelect } from "@/components/requestor/wizard/wizard-select";
import { WizardTextarea } from "@/components/requestor/wizard/wizard-textarea";
import {
  FIELD_ERROR,
  FIELD_LABEL,
  FIELD_SM,
  fieldBorder,
  STEP_HEADING,
  STEP_SUBHEADING,
  STEP_SUBSECTION,
  WIZARD_DUPLICATE_TRIP,
} from "@/components/requestor/wizard/wizard-theme";
import { useFieldHistory } from "@/hooks/use-field-history";
import { cn } from "@/lib/utils";
import type {
  BookingDraft,
  DraftErrors,
  PassengerDraft,
  ScheduleField,
  TripDraft,
  TripErrors,
} from "@/modules/reservations/draft";
import {
  DEV_TOWER_HEADS,
  TRIP_PURPOSES,
} from "@/modules/reservations/reference";
import { MAX_TRIPS_PER_SUBMISSION } from "@/modules/reservations/wire";

interface StepTripsProps {
  /**
   * Editing a saved request: it is one trip, so nothing here adds, duplicates or
   * removes one. The server refuses a multi-trip edit too.
   */
  editing?: boolean;
  draft: BookingDraft;
  errors: DraftErrors;
  onTrip: (index: number, patch: Partial<TripDraft>) => void;
  onAddTrip: () => void;
  onDuplicateTrip: (index: number) => void;
  onRemoveTrip: (index: number) => void;
  onPassenger: (
    tripIndex: number,
    passengerIndex: number,
    patch: Partial<PassengerDraft>,
  ) => void;
  onAddPassenger: (tripIndex: number) => void;
  onRemovePassenger: (tripIndex: number, passengerIndex: number) => void;
}

/**
 * Step 3 — one block per trip (pickup mode) or per date (standby mode).
 *
 * The two modes collect materially different schedules: a pickup is one instant
 * plus two places, a standby is a window plus one place. They are separate
 * blocks below rather than one parameterised grid, because the field COUNT,
 * labels and grid spans all differ, and a single abstraction covering both ends
 * up harder to read than the two written out.
 */
export function StepTrips({
  editing = false,
  draft,
  errors,
  onTrip,
  onAddTrip,
  onDuplicateTrip,
  onRemoveTrip,
  onPassenger,
  onAddPassenger,
  onRemovePassenger,
}: StepTripsProps) {
  const standby = draft.mode === "standby";
  const onlyOne = draft.trips.length === 1;
  // Server-enforced too (`bookingDraftSchema`), but refusing it here means a
  // requestor never fills in nine more blocks only to have the submit refused.
  const atCap = draft.trips.length >= MAX_TRIPS_PER_SUBMISSION;
  const capHint = `Maximum of ${MAX_TRIPS_PER_SUBMISSION} ${standby ? "dates" : "trips"} per submission.`;
  const history = useFieldHistory();

  return (
    <>
      <h2 className={STEP_HEADING}>
        {standby ? "Standby dates" : "Trip details"}
      </h2>
      <p className={cn(STEP_SUBHEADING, "mt-1.5 mb-[22px]")}>
        {editing
          ? "Update anything that changed. Everything marked * is required."
          : standby
            ? "Add one block per day the van is needed."
            : "Add one block per trip. Everything marked * is required."}
      </p>

      <div className="flex flex-col gap-[26px]">
        {draft.trips.map((trip, index) => {
          const tripErrors = errors.trips[index];
          const label = `${standby ? "Date" : "Trip"} ${index + 1}`;

          return (
            <section
              // biome-ignore lint/suspicious/noArrayIndexKey: same reasoning as passenger-list.tsx — controlled inputs only
              key={index}
              aria-label={label}
              className="rounded-card border border-gray-6 bg-brand-wash px-4 py-5 md:px-8 md:py-[30px]"
            >
              <div className="mb-[22px] flex items-center gap-3">
                <h3 className="text-[1.375rem] font-medium text-brand">
                  {label}
                </h3>
                {!editing && (
                  <Hint
                    content="A booking needs at least one trip."
                    when={onlyOne}
                    wrap
                    wrapClassName="ml-auto"
                  >
                    <button
                      type="button"
                      onClick={() => onRemoveTrip(index)}
                      disabled={onlyOne}
                      aria-label={`Remove ${label}`}
                      className={cn(
                        "ml-auto flex items-center gap-2 rounded-pill bg-error px-5 py-2.5 text-body font-medium text-primary-foreground hover:brightness-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-error",
                        onlyOne
                          ? "cursor-not-allowed opacity-40"
                          : "cursor-pointer",
                      )}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      Remove
                    </button>
                  </Hint>
                )}
              </div>

              <WizardSelect
                label="Purpose"
                placeholder="Select Purpose"
                value={trip.purpose}
                options={TRIP_PURPOSES}
                invalid={tripErrors.purpose !== undefined}
                error={tripErrors.purpose}
                onChange={(purpose) => onTrip(index, { purpose })}
              />

              <WizardTextarea
                label="Details for Event Purpose"
                placeholder="What is this trip for?"
                value={trip.details}
                rows={3}
                invalid={tripErrors.details !== undefined}
                error={tripErrors.details}
                onChange={(details) => onTrip(index, { details })}
              />

              {standby && (
                <WizardSelect
                  label="Approving Tower Head"
                  placeholder="Select Tower Head"
                  value={trip.towerHead}
                  options={DEV_TOWER_HEADS}
                  invalid={tripErrors.towerHead !== undefined}
                  error={tripErrors.towerHead}
                  onChange={(towerHead) => onTrip(index, { towerHead })}
                />
              )}

              <PassengerList
                tower={trip.tower}
                onTower={(tower) => onTrip(index, { tower })}
                passengers={trip.passengers}
                errors={tripErrors}
                tripLabel={label}
                onChange={(passengerIndex, patch) =>
                  onPassenger(index, passengerIndex, patch)
                }
                onAdd={() => onAddPassenger(index)}
                onRemove={(passengerIndex) =>
                  onRemovePassenger(index, passengerIndex)
                }
              />

              {standby ? (
                <StandbyWindow
                  trip={trip}
                  errors={tripErrors}
                  pickupPointSuggestions={history.pickupPoint}
                  onChange={(patch) => onTrip(index, patch)}
                />
              ) : (
                <PickupSchedule
                  trip={trip}
                  errors={tripErrors}
                  pickupPointSuggestions={history.pickupPoint}
                  dropoffPointSuggestions={history.dropoffPoint}
                  onChange={(patch) => onTrip(index, patch)}
                />
              )}

              {tripErrors.schedule !== undefined && (
                <p role="alert" className="mt-3 text-xs text-error">
                  {tripErrors.schedule}
                </p>
              )}

              {!editing && (
                <>
                  <hr className="mt-6 mb-5 border-gray-6" />

                  <Hint content={capHint} when={atCap} wrap>
                    <button
                      type="button"
                      onClick={() => onDuplicateTrip(index)}
                      disabled={atCap}
                      className={cn(
                        WIZARD_DUPLICATE_TRIP,
                        atCap &&
                          "cursor-not-allowed opacity-50 hover:brightness-100",
                      )}
                    >
                      <Copy aria-hidden="true" className="size-4" />
                      Duplicate {standby ? "Date" : "Trip"}
                    </button>
                  </Hint>
                </>
              )}
            </section>
          );
        })}

        {!editing && (
          <Hint content={capHint} when={atCap} wrap wrapClassName="w-full">
            <button
              type="button"
              onClick={onAddTrip}
              disabled={atCap}
              className={cn(
                "rounded-card border-[1.5px] border-dashed border-primary bg-background p-[18px] text-[1.0625rem] font-semibold text-brand focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
                atCap
                  ? "w-full cursor-not-allowed opacity-50"
                  : "w-full cursor-pointer hover:bg-brand-wash",
              )}
            >
              + {standby ? "Add another date" : "Add another trip"}
            </button>
          </Hint>
        )}
      </div>
    </>
  );
}

interface ScheduleProps {
  trip: TripDraft;
  errors: TripErrors;
  onChange: (patch: Partial<TripDraft>) => void;
}

/**
 * One labelled control. `field` drives both the value and the error border.
 * `suggestions` is only ever passed for a `type="text"` location field — a
 * date or time input never gets one, there is nothing meaningful to
 * autocomplete about a calendar picker.
 *
 * Named `ScheduleInput`, not `ScheduleField` — the latter is the imported union
 * of field names it takes as a prop, and shadowing a type with a component that
 * consumes it makes both harder to follow.
 */
function ScheduleInput({
  trip,
  errors,
  onChange,
  field,
  label,
  type,
  placeholder,
  suggestions,
  className,
}: ScheduleProps & {
  field: ScheduleField;
  label: string;
  type: "date" | "time" | "text";
  placeholder?: string;
  suggestions?: readonly string[];
  className?: string;
}) {
  const invalid = errors.missing[field] === true;
  const id = useId();

  if (suggestions === undefined) {
    return (
      <div className={className}>
        <label className={FIELD_LABEL}>
          {label} <span className="text-error">*</span>
          <input
            type={type}
            value={trip[field]}
            placeholder={placeholder}
            aria-invalid={invalid}
            onChange={(event) => onChange({ [field]: event.target.value })}
            className={cn(FIELD_SM, fieldBorder(invalid), "mt-1.5")}
          />
        </label>
      </div>
    );
  }

  return (
    <div className={className}>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label} <span className="text-error">*</span>
      </label>
      <WizardComboInput
        id={id}
        type="text"
        value={trip[field]}
        suggestions={suggestions}
        placeholder={placeholder}
        invalid={invalid}
        onChange={(value) => onChange({ [field]: value })}
        className={cn(FIELD_SM, fieldBorder(invalid), "mt-1.5")}
      />
    </div>
  );
}

function PickupSchedule(
  props: ScheduleProps & {
    pickupPointSuggestions: readonly string[];
    dropoffPointSuggestions: readonly string[];
  },
) {
  return (
    <>
      <h4 className={cn(STEP_SUBSECTION, "mt-8 mb-3.5")}>Schedule</h4>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-x-5">
        <ScheduleInput
          {...props}
          field="pickupDate"
          label="Pickup Date"
          type="date"
        />
        <ScheduleInput
          {...props}
          field="pickupTime"
          label="Pickup Time"
          type="time"
        />
        <ScheduleInput
          {...props}
          field="pickupPoint"
          label="Pickup Point"
          type="text"
          placeholder="e.g. GLS Tower lobby"
          suggestions={props.pickupPointSuggestions}
        />
        <ScheduleInput
          {...props}
          field="dropoffPoint"
          label="Drop-off Point"
          type="text"
          placeholder="e.g. AGT Building"
          suggestions={props.dropoffPointSuggestions}
        />
      </div>
    </>
  );
}

function StandbyWindow(
  props: ScheduleProps & { pickupPointSuggestions: readonly string[] },
) {
  return (
    <>
      <h4 className={cn(STEP_SUBSECTION, "mt-8 mb-3.5")}>Standby Window</h4>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-x-5">
        <ScheduleInput
          {...props}
          field="startDate"
          label="Start Date"
          type="date"
        />
        <ScheduleInput
          {...props}
          field="endDate"
          label="End Date"
          type="date"
        />
        <ScheduleInput
          {...props}
          field="startTime"
          label="Start Time"
          type="time"
        />
        <ScheduleInput
          {...props}
          field="endTime"
          label="End Time"
          type="time"
        />
        <ScheduleInput
          {...props}
          field="pickupPoint"
          label="Reporting Point"
          type="text"
          placeholder="Where should the van wait?"
          suggestions={props.pickupPointSuggestions}
          className="md:col-span-2"
        />
      </div>
      <p className={cn(FIELD_ERROR, "text-gray-2")}>
        A standby van is held for the whole window and is charged to the
        approving Tower Head.
      </p>
    </>
  );
}
