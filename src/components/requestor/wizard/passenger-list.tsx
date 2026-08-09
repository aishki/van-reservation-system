"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Hint } from "@/components/common/hint";
import {
  FIELD_ERROR,
  FIELD_LABEL_SM,
  FIELD_SM,
  fieldBorder,
} from "@/components/requestor/wizard/wizard-theme";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError, apiFetch } from "@/lib/api-fetcher";
import { cn } from "@/lib/utils";
import { canonicalDomainId } from "@/modules/auth/domain-id";
import type { PassengerDraft, TripErrors } from "@/modules/reservations/draft";

const DOMAIN_ID_LENGTH = 7;
const LOOKUP_DEBOUNCE_MS = 350;

interface LookupResponse {
  found: boolean;
  name?: string;
}

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
 * Domain IDs upper-case as they are typed rather than via `text-transform`. CSS
 * would only change the rendering, leaving the lower-case value in state to be
 * submitted and compared case-sensitively against `users.domain_id`.
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
            // A passenger has no identity until it is saved, and two blank
            // rows are indistinguishable, so reconciling by index is the only
            // stable option. PassengerRow does own real per-row state now —
            // the debounce timer and the useQuery subscription — so a mid-
            // list removal hands the surviving row's state to a different
            // passenger for one debounce cycle: `debounced` still holds the
            // old occupant's id while `passenger.domainId` is the new one's.
            // Safe only because `complete` gates every derived flag (nothing
            // renders off the mismatched pair) and the query cache is keyed
            // by id value, not row identity, so the re-settle resolves
            // instantly from cache rather than refetching.
            // Known cost: removing a middle row drops focus to the body,
            // because the DOM node the caret was in is the one that unmounts.
            // biome-ignore lint/suspicious/noArrayIndexKey: safe per the invariant above
            key={index}
            passenger={passenger}
            index={index}
            row={
              errors.passengerRows[index] ?? { domainId: false, name: false }
            }
            onlyOne={onlyOne}
            tripLabel={tripLabel}
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
  row: { domainId: boolean; name: boolean };
  onlyOne: boolean;
  tripLabel: string;
  onChange: (patch: Partial<PassengerDraft>) => void;
  onRemove: () => void;
}

/**
 * One passenger row: a Domain ID input and the name it resolves to.
 *
 * The name is never typed — it is derived from the Domain ID via
 * `/api/associates/lookup`, debounced so the lookup fires once the user
 * pauses rather than on every keystroke.
 */
function PassengerRow({
  passenger,
  index,
  row,
  onlyOne,
  tripLabel,
  onChange,
  onRemove,
}: PassengerRowProps) {
  const debouncedId = useDebouncedValue(passenger.domainId, LOOKUP_DEBOUNCE_MS);
  // Both guards matter: `debouncedId` alone would fire a stale lookup while
  // the user is still editing back below 7 characters. This gate is also
  // what makes the array-index key on this row safe (see the comment above
  // `key={index}` in PassengerList) — it stops a transiently mismatched
  // debounce/query pair from rendering anything after a mid-list removal.
  const complete =
    passenger.domainId.length === DOMAIN_ID_LENGTH &&
    debouncedId === passenger.domainId;

  const lookup = useQuery({
    queryKey: ["associate-name", debouncedId],
    queryFn: () =>
      apiFetch<LookupResponse>("/api/associates/lookup", {
        method: "POST",
        body: JSON.stringify({ domainId: debouncedId }),
      }),
    enabled: complete,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  // Write the resolved name into the draft — the draft stays the single
  // source of truth for submit/validation; the query only feeds it.
  const resolvedName =
    complete && lookup.data?.found ? (lookup.data.name ?? "") : "";
  useEffect(() => {
    if (resolvedName !== "" && resolvedName !== passenger.name) {
      onChange({ name: resolvedName });
    }
  }, [resolvedName, passenger.name, onChange]);

  const pending = complete && lookup.isPending;
  const notRegistered = complete && lookup.data?.found === false;
  const failed = complete && lookup.isError;
  // An ApiError carries the route's user-facing message; anything else (e.g.
  // a network TypeError, or an ApiError with code "UNKNOWN" carrying
  // apiFetch's technical "failed with status …" text for a non-envelope
  // failure) falls back to the generic copy.
  const failureMessage =
    lookup.error instanceof ApiError &&
    lookup.error.code !== "UNKNOWN" &&
    lookup.error.message !== ""
      ? lookup.error.message
      : "Couldn't check that Domain ID right now.";

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
          <label className={FIELD_LABEL_SM}>
            Domain ID <span className="text-error">*</span>
            <input
              type="text"
              value={passenger.domainId}
              maxLength={7}
              placeholder="AB12345"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={row.domainId}
              onChange={(event) =>
                onChange({
                  domainId: canonicalDomainId(event.target.value),
                  name: "",
                })
              }
              className={cn(FIELD_SM, fieldBorder(row.domainId), "mt-1.5")}
            />
          </label>
        </div>

        <div>
          <label className={FIELD_LABEL_SM}>
            Passenger Name <span className="text-error">*</span>
            <Hint content="Filled automatically from the Domain ID.">
              <input
                type="text"
                value={passenger.name}
                readOnly
                tabIndex={-1}
                placeholder={pending ? "Looking up…" : "Derived from Domain ID"}
                aria-invalid={row.name}
                className={cn(
                  FIELD_SM,
                  fieldBorder(row.name),
                  "mt-1.5 cursor-default select-none",
                )}
              />
            </Hint>
          </label>
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

      {(notRegistered || failed) && (
        <p role="alert" className={FIELD_ERROR}>
          {notRegistered ? "This Domain ID isn't registered." : failureMessage}
        </p>
      )}
    </div>
  );
}
