"use client";

import { Info } from "lucide-react";
import { useId } from "react";
import { Hint } from "@/components/common/hint";
import { WizardComboInput } from "@/components/requestor/wizard/wizard-combo-input";
import { WizardSelect } from "@/components/requestor/wizard/wizard-select";
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
import { TOWERS } from "@/modules/reservations/reference";

interface PassengerListProps {
  tower: string;
  onTower: (tower: string) => void;
  passengers: PassengerDraft[];
  errors: TripErrors;
  /** Label prefix for the remove control, e.g. "Trip 1". */
  tripLabel: string;
  onChange: (index: number, patch: Partial<PassengerDraft>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

/**
 * Tower (which business unit the trip's passengers belong to) plus the
 * passenger repeater: a stepper for the count, then one row per passenger.
 *
 * Tower lives here, not in `step-trips.tsx` alongside Purpose, purely for
 * layout — the design wants it directly above "Number of Passengers" — even
 * though it is a `TripDraft` field like Purpose, not a per-passenger one;
 * `tower`/`onTower` are threaded straight through from the trip.
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
  tower,
  onTower,
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

      <WizardSelect
        label="Tower"
        labelHint={
          <Hint content="If passengers belong to more than one tower, selecting which one to record is at your discretion — choose whichever applies best.">
            <button
              type="button"
              aria-label="What to pick when passengers span more than one tower"
              className="flex cursor-pointer items-center text-brand"
            >
              <Info aria-hidden="true" className="size-4" />
            </button>
          </Hint>
        }
        placeholder="Select Tower"
        value={tower}
        options={TOWERS}
        invalid={errors.tower !== undefined}
        error={errors.tower}
        onChange={onTower}
      />

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

/**
 * The column template every one of this row's three grids shares, so a
 * name/email/avatar/remove-button lines up across all three regardless of
 * how much (or how little) content each grid holds.
 */
const ROW_GRID =
  "grid grid-cols-[32px_1fr] gap-3 md:grid-cols-[32px_1fr_1fr_34px]";

/**
 * One passenger row: a name and an optional email, both typed by hand.
 *
 * THREE stacked grids, not one — labels, then controls, then an optional
 * error line — all sharing `ROW_GRID`. A single grid with the error message
 * living inside the email cell was the original shape, but CSS Grid sizes
 * every row to its TALLEST item: the moment the email cell grew an error
 * line, `items-end` pushed the avatar, the name field and the remove button
 * down to match, so a bad email visibly knocked the whole row out of
 * alignment with itself. Isolating the error into its own grid removes it
 * from the controls row's height calculation entirely — the controls row is
 * always exactly the height of an input, so `items-center` there centers the
 * avatar and remove button against the input precisely, with or without an
 * error showing.
 */
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
  const emailErrorId = useId();

  return (
    <div>
      <div className={ROW_GRID}>
        <span aria-hidden="true" />
        <label htmlFor={nameId} className={FIELD_LABEL_SM}>
          Passenger Name <span className="text-error">*</span>
        </label>
        <label htmlFor={emailId} className={FIELD_LABEL_SM}>
          Passenger Email
        </label>
        <span aria-hidden="true" />
      </div>

      <div className={cn(ROW_GRID, "items-center")}>
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-pill bg-brand-tint text-sm font-semibold text-brand"
        >
          {index + 1}
        </span>

        <WizardComboInput
          id={nameId}
          type="text"
          value={passenger.name}
          suggestions={nameSuggestions}
          placeholder="Juan Dela Cruz"
          invalid={row.name}
          onChange={(name) => onChange({ name })}
          className={cn(FIELD_SM, fieldBorder(row.name))}
        />

        <WizardComboInput
          id={emailId}
          type="email"
          value={passenger.email}
          suggestions={emailSuggestions}
          placeholder="name@example.com (optional)"
          invalid={row.email}
          aria-describedby={row.email ? emailErrorId : undefined}
          onChange={(email) => onChange({ email })}
          className={cn(FIELD_SM, fieldBorder(row.email))}
        />

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
        <div className={cn(ROW_GRID, "mt-1")}>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <p id={emailErrorId} role="alert" className={FIELD_ERROR}>
            {MESSAGES.passengerEmailFormat}
          </p>
          <span aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
