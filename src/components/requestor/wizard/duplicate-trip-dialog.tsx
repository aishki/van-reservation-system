"use client";

import { useEffect, useRef } from "react";

interface DuplicateTripDialogProps {
  /** `[i, j]` pairs of trip indices ( `i < j` ) that read as the same request. */
  pairs: [number, number][];
  /** Renames "Trip" to "Date" in the message, matching the rest of step 3. */
  standby: boolean;
  onDismiss: () => void;
}

/**
 * Blocks step 3 → 4 when two or more trips are identical enough to be the
 * same request submitted twice — almost always an un-edited "Duplicate
 * Trip"/"Duplicate Date" click. See `findDuplicateTripPairs` for exactly
 * what "identical" means here.
 *
 * A HARD block, not a "continue anyway" confirmation: the one way past it is
 * to actually change something, which the body text points at directly
 * (Details is the field that differentiates two otherwise-real duplicate
 * trips). A bypass button would just turn this into one more click to
 * dismiss, defeating the point of catching an accidental click in the first
 * place.
 *
 * Same native `<dialog>` + `showModal()` pattern as `CancelDialog` in
 * `manage-view.tsx` — see that component's comment for why it has to be the
 * real element and not a styled `<div>`.
 */
export function DuplicateTripDialog({
  pairs,
  standby,
  onDismiss,
}: DuplicateTripDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const noun = standby ? "Date" : "Trip";

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Trip numbers involved, deduplicated and sorted — "Trip 1, Trip 2 and Trip
  // 3", not "Trip 1 and Trip 2; Trip 1 and Trip 3; Trip 2 and Trip 3" for the
  // same three-way duplicate.
  const involved = [...new Set(pairs.flat())]
    .sort((a, b) => a - b)
    .map((i) => `${noun} ${i + 1}`);
  const list = new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction",
  }).format(involved);

  return (
    <dialog
      ref={ref}
      aria-labelledby="duplicate-trip-dialog-title"
      onCancel={onDismiss}
      className="m-auto w-full max-w-[480px] rounded-card bg-background px-8 py-[30px] backdrop:bg-[color-mix(in_srgb,var(--color-gray-1)_45%,transparent)]"
    >
      <h3
        id="duplicate-trip-dialog-title"
        className="mb-2.5 text-[1.375rem] font-semibold text-plum"
      >
        Duplicate Entry Detected
      </h3>
      <p className="mb-3 text-body text-pretty text-gray-2">
        {list} have the same purpose, passengers, pickup/drop-off points, and
        schedule. To reduce the back-and-forth of rejecting duplicate entries,
        please double-check your trips before continuing.
      </p>
      <p className="mb-6 text-body text-pretty text-gray-2">
        If this is intentional, add a note explaining why in that trip's{" "}
        <span className="font-semibold text-gray-1">
          Details for Event Purpose
        </span>{" "}
        field.
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className="cursor-pointer rounded-pill bg-brand px-6 py-3.5 text-body font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Review Trips
        </button>
      </div>
    </dialog>
  );
}
