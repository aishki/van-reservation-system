"use client";

import { Trash2 } from "lucide-react";
import { Hint } from "@/components/common/hint";
import { PassengerList } from "@/components/requestor/wizard/passenger-list";
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
} from "@/components/requestor/wizard/wizard-theme";
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

interface StepTripsProps {
  draft: BookingDraft;
  errors: DraftErrors;
  onTrip: (index: number, patch: Partial<TripDraft>) => void;
  onAddTrip: () => void;
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
  draft,
  errors,
  onTrip,
  onAddTrip,
  onRemoveTrip,
  onPassenger,
  onAddPassenger,
  onRemovePassenger,
}: StepTripsProps) {
  const standby = draft.mode === "standby";
  const onlyOne = draft.trips.length === 1;

  return (
    <>
      <h2 className={STEP_HEADING}>
        {standby ? "Standby dates" : "Trip details"}
      </h2>
      <p className={cn(STEP_SUBHEADING, "mt-1.5 mb-[22px]")}>
        {standby
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
                  onChange={(patch) => onTrip(index, patch)}
                />
              ) : (
                <PickupSchedule
                  trip={trip}
                  errors={tripErrors}
                  onChange={(patch) => onTrip(index, patch)}
                />
              )}

              {tripErrors.schedule !== undefined && (
                <p role="alert" className="mt-3 text-xs text-error">
                  {tripErrors.schedule}
                </p>
              )}
            </section>
          );
        })}

        <button
          type="button"
          onClick={onAddTrip}
          className="cursor-pointer rounded-card border-[1.5px] border-dashed border-primary bg-background p-[18px] text-[1.0625rem] font-semibold text-brand hover:bg-brand-wash focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          + {standby ? "Add another date" : "Add another trip"}
        </button>
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
  className,
}: ScheduleProps & {
  field: ScheduleField;
  label: string;
  type: "date" | "time" | "text";
  placeholder?: string;
  className?: string;
}) {
  const invalid = errors.missing[field] === true;
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

function PickupSchedule(props: ScheduleProps) {
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
        />
        <ScheduleInput
          {...props}
          field="dropoffPoint"
          label="Drop-off Point"
          type="text"
          placeholder="e.g. AGT Building"
        />
      </div>
    </>
  );
}

function StandbyWindow(props: ScheduleProps) {
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
