"use client";

import { useId } from "react";
import { Hint } from "@/components/common/hint";
import { WizardComboInput } from "@/components/requestor/wizard/wizard-combo-input";
import {
  FIELD_ERROR,
  FIELD_LABEL_SM,
  FIELD_SM,
  fieldBorder,
} from "@/components/requestor/wizard/wizard-theme";
import { useFieldHistory } from "@/hooks/use-field-history";
import { cn } from "@/lib/utils";
import {
  MESSAGES,
  type PassengerDraft,
  type TripErrors,
} from "@/modules/reservations/draft";

interface PassengerListProps {
  passengers: PassengerDraft[];
  errors: TripErrors;
  /** Label prefix for the remove control, e.g. "Trip 1". */
  tripLabel: string;
  onChange: (index: number, patch: Partial<PassengerDraft>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/**
 * The passenger repeater: a stepper for the count, then one row per passenger.
 *
 * The count control and the list are two views of one array — pressing "+" and
 * pressing "Add another passenger" do the same thing. The design ships both, so
 * both are here, but they share a single handler rather than each mutating
 * separately.
 *
 * `aria-live="polite"` on the count means adding or removing a row is announced;
 * without it the only feedback is a visual row appearing, and a keyboard user
 * who just pressed "−" gets nothing.
 *
 * Both fields are manual entry — there is no DIRECTORY lookup here yet. What
 * they do have is the requestor's own HISTORY: `WizardComboInput` suggests
 * names and emails this requestor has typed on a past booking, purely a
 * convenience for someone who books the same few people repeatedly. A
 * name-search endpoint the API owner is building will eventually offer
 * directory suggestions too and fill in the matched person's email
 * automatically, the way the old Domain ID lookup filled in the name — but
 * Passenger Email stays optional even then: many passengers are external
 * clients with no corporate account to search for.
 */
export function PassengerList({
  passengers,
  errors,
  tripLabel,
  onChange,
  onAdd,
  onRemove,
}: PassengerListProps) {
  const onlyOne = passengers.length === 1;
  const history = useFieldHistory();

  return (
    <>
      <h4 className="mt-[30px] mb-3.5 text-[1.0625rem] leading-6 font-semibold text-gray-1">
        Passengers
      </h4>

      <span className="mb-2.5 block text-body text-gray-1">
        Number of Passengers
      </span>
      <div className="mb-[18px] flex items-center gap-3.5">
        <Hint
          content="A trip needs at least one passenger."
          when={onlyOne}
          wrap
        >
          <button
            type="button"
            onClick={() => onRemove(passengers.length - 1)}
            disabled={onlyOne}
            aria-label="Remove one passenger"
            className={cn(
              "size-9 rounded-pill border bg-background text-xl leading-none hover:border-primary focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
              onlyOne
                ? "cursor-not-allowed border-gray-6 text-gray-3"
                : "cursor-pointer border-gray-4 text-gray-1",
            )}
          >
            −
          </button>
        </Hint>
        <output
          aria-live="polite"
          className="min-w-16 rounded-field border border-gray-4 bg-background py-2.5 text-center text-body"
        >
          {passengers.length}
        </output>
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add one passenger"
          className="size-9 cursor-pointer rounded-pill border border-gray-4 bg-background text-xl leading-none text-gray-1 hover:border-primary focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          +
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {passengers.map((passenger, index) => (
          <PassengerRow
            // A passenger has no stable identity of its own — two blank rows
            // are indistinguishable — so reconciling by index is the only
            // option. Both fields are plain controlled inputs with no
            // per-row async state (unlike the old lookup-driven row), so a
            // mid-list removal has no stale-state hazard to guard against.
            // biome-ignore lint/suspicious/noArrayIndexKey: safe per the comment above
            key={index}
            passenger={passenger}
            index={index}
            row={errors.passengerRows[index] ?? { name: false, email: false }}
            onlyOne={onlyOne}
            tripLabel={tripLabel}
            nameSuggestions={history.passengerName}
            emailSuggestions={history.passengerEmail}
            onChange={(patch) => onChange(index, patch)}
            onRemove={() => onRemove(index)}
          />
        ))}

        {errors.passengers !== undefined && (
          <p role="alert" className={FIELD_ERROR}>
            {errors.passengers}
          </p>
        )}

        <button
          type="button"
          onClick={onAdd}
          className="flex cursor-pointer items-center justify-center gap-2.5 rounded-field border-[1.5px] border-dashed border-primary bg-brand-wash p-4 text-[1.0625rem] font-medium text-brand hover:bg-brand-tint focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          + Add another passenger
        </button>
      </div>
    </>
  );
}

interface PassengerRowProps {
  passenger: PassengerDraft;
  index: number;
  row: { name: boolean; email: boolean };
  onlyOne: boolean;
  tripLabel: string;
  nameSuggestions: readonly string[];
  emailSuggestions: readonly string[];
  onChange: (patch: Partial<PassengerDraft>) => void;
  onRemove: () => void;
}

/** One passenger row: a name and an optional email, both typed by hand. */
function PassengerRow({
  passenger,
  index,
  row,
  onlyOne,
  tripLabel,
  nameSuggestions,
  emailSuggestions,
  onChange,
  onRemove,
}: PassengerRowProps) {
  const nameId = useId();
  const emailId = useId();

  return (
    <div>
      <div className="grid grid-cols-[32px_1fr] items-end gap-3 md:grid-cols-[32px_1fr_1fr_34px]">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-pill bg-brand-tint text-sm font-semibold text-brand"
        >
          {index + 1}
        </span>

        <div>
          <label htmlFor={nameId} className={FIELD_LABEL_SM}>
            Passenger Name <span className="text-error">*</span>
          </label>
          <WizardComboInput
            id={nameId}
            type="text"
            value={passenger.name}
            suggestions={nameSuggestions}
            placeholder="Juan Dela Cruz"
            invalid={row.name}
            onChange={(name) => onChange({ name })}
            className={cn(FIELD_SM, fieldBorder(row.name), "mt-1.5")}
          />
        </div>

        <div>
          <label htmlFor={emailId} className={FIELD_LABEL_SM}>
            Passenger Email
          </label>
          <WizardComboInput
            id={emailId}
            type="email"
            value={passenger.email}
            suggestions={emailSuggestions}
            placeholder="name@example.com (optional)"
            invalid={row.email}
            onChange={(email) => onChange({ email })}
            className={cn(FIELD_SM, fieldBorder(row.email), "mt-1.5")}
          />
        </div>

        <Hint
          content="A trip needs at least one passenger."
          when={onlyOne}
          wrap
          wrapClassName="justify-self-end"
        >
          <button
            type="button"
            onClick={onRemove}
            disabled={onlyOne}
            aria-label={`Remove passenger ${index + 1} from ${tripLabel}`}
            className={cn(
              "size-[34px] justify-self-end rounded-field border border-error-tint-border bg-error-tint text-base leading-none text-error focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-error",
              onlyOne ? "cursor-not-allowed opacity-45" : "cursor-pointer",
            )}
          >
            ✕
          </button>
        </Hint>
      </div>

      {row.email && (
        <p role="alert" className={FIELD_ERROR}>
          {MESSAGES.passengerEmailFormat}
        </p>
      )}
    </div>
  );
}
