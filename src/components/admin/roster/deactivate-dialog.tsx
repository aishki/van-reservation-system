"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { BUTTON_SECONDARY } from "@/components/admin/admin-theme";
import { apiFetch } from "@/lib/api-fetcher";
import { formatPlainDate } from "@/lib/tz";
import type { AffectedTrip } from "@/modules/roster/conflicts";

export interface DeactivateDialogProps {
  target: "driver" | "van";
  id: string;
  /** Driver name or van number — whatever the row's own table shows first. */
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const RESOURCE_PATH: Record<DeactivateDialogProps["target"], string> = {
  driver: "/api/drivers",
  van: "/api/vans",
};

/**
 * The warning shown before a Deactivate takes effect.
 *
 * Deactivating does NOT unassign anything — a trip already assigned keeps its
 * driver or van and stays valid; the row simply stops taking NEW assignments.
 * This lists what is already on the books so the admin sees the consequence,
 * but it never blocks: Deactivate stays clickable even before the list has
 * loaded and even when it is not empty. Refusing to deactivate would strand
 * the admin at the exact moment it is most needed — someone resigning
 * mid-schedule.
 */
export function DeactivateDialog({
  target,
  id,
  name,
  onConfirm,
  onCancel,
}: DeactivateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const query = useQuery({
    queryKey: ["roster", target, id, "affected"],
    queryFn: () =>
      apiFetch<AffectedTrip[]>(`${RESOURCE_PATH[target]}/${id}/affected`),
  });
  const trips = query.data ?? [];

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Deactivate ${name}`}
      onCancel={onCancel}
      className="m-auto w-full max-w-[560px] rounded-card border-0 bg-background p-6 backdrop:bg-[color-mix(in_srgb,var(--color-gray-1)_35%,transparent)]"
    >
      <h2 className="text-xl font-semibold text-gray-1">Deactivate {name}?</h2>

      {trips.length > 0 ? (
        <div className="mt-4">
          <p className="text-body text-gray-1">
            <strong>
              {name} is assigned to {trips.length} upcoming{" "}
              {trips.length === 1 ? "trip" : "trips"}.
            </strong>
          </p>
          <p className="mt-1.5 text-body text-gray-2">
            Deactivating stops NEW assignments. These trips keep their assigned{" "}
            {target} and remain valid.
          </p>
          <div className="mt-4 max-h-[220px] overflow-y-auto rounded-field border border-gray-6">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="border-b border-gray-4 bg-gray-5 px-3 py-2 text-left font-semibold text-gray-1"
                  >
                    Reference
                  </th>
                  <th
                    scope="col"
                    className="border-b border-gray-4 bg-gray-5 px-3 py-2 text-left font-semibold text-gray-1"
                  >
                    Date
                  </th>
                  <th
                    scope="col"
                    className="border-b border-gray-4 bg-gray-5 px-3 py-2 text-left font-semibold text-gray-1"
                  >
                    Requestor
                  </th>
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => (
                  <tr key={trip.reference} className="border-b border-gray-6">
                    <td className="px-3 py-2 text-gray-1">{trip.reference}</td>
                    <td className="px-3 py-2 text-gray-1">
                      {formatPlainDate(trip.startDate) ?? trip.startDate}
                    </td>
                    <td className="px-3 py-2 text-gray-1">{trip.requestor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        // Loading and "genuinely none" render the same line deliberately —
        // Deactivate is never gated on this query, so there is nothing to
        // distinguish a spinner state for.
        <p className="mt-4 text-body text-gray-2">
          {name} has no upcoming trips assigned.
        </p>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="cursor-pointer rounded-pill border-0 bg-error px-9 py-3.5 text-[1.0625rem] font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-error"
        >
          Deactivate
        </button>
      </div>
    </dialog>
  );
}
