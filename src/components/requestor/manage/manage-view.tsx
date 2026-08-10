"use client";

import { CalendarCheck, CalendarClock, History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BookingsTable,
  EmptyState,
} from "@/components/requestor/manage/bookings-table";
import { ApiError, apiFetch } from "@/lib/api-fetcher";
import { formatPlainDate } from "@/lib/tz";
import { cn } from "@/lib/utils";
import {
  filterReservations,
  MANAGE_MODE_LABELS,
  MANAGE_MODES,
  type ManageMode,
  TRIP_WINDOW_LABELS,
  TRIP_WINDOWS,
  type TripWindow,
  windowCounts,
} from "@/modules/reservations/manage-filters";
import type { ReservationRow } from "@/modules/reservations/types";

const TRIP_WINDOW_ICONS: Record<TripWindow, typeof CalendarCheck> = {
  all: CalendarCheck,
  upcoming: CalendarClock,
  past: History,
};

interface ManageViewProps {
  initialRows: ReservationRow[];
  /** Manila's today, computed on the server — see `todayInManila`. */
  today: string;
}

/**
 * Manage bookings: filter rail, ride-mode tabs, the requests table.
 *
 * `today` arrives as a prop rather than being read from the clock here. The
 * upcoming/past split depends on it, and computing it during render would let the
 * server and the client disagree either side of Manila midnight — reclassifying a
 * row between the server HTML and hydration.
 *
 * Cancellation writes through to the database and then updates the local row,
 * rather than the reverse: this page is server-rendered once, so an optimistic
 * update that later failed would leave the table claiming a cancellation that
 * never happened until the requestor reloaded.
 */
export function ManageView({ initialRows, today }: ManageViewProps) {
  const [rows, setRows] = useState(initialRows);
  const [mode, setMode] = useState<ManageMode>("all");
  const [window, setWindow] = useState<TripWindow>("all");
  const [pendingCancel, setPendingCancel] = useState<ReservationRow | null>(
    null,
  );
  const [cancelling, setCancelling] = useState(false);

  const counts = windowCounts(rows, mode, today);
  const visible = filterReservations(rows, { mode, window }, today);

  /**
   * `POST /api/reservations/:id/cancel`.
   *
   * Not a `DELETE`: nothing is removed. The endpoint sets the status to
   * `Cancelled` and records a `cancelled` event naming who ended it. It
   * authorizes against the session — a requestor may cancel only their OWN
   * pending or approved booking, and a non-owner gets the same 404 as an
   * unknown reference — so the row menu deciding what to offer stays a
   * convenience, never the check. No body is sent: the dialog asks for no
   * reason, and the server stores a default naming the actor, because the
   * schema requires a reason and a role together.
   *
   * The local row is updated only after the write lands, so a failure leaves
   * the table showing what the database actually holds. Only `status` moves:
   * `updatedBy` reports the last ADMIN to act, and a requestor's cancellation
   * writes an `associate` event, so setting it here would disagree with the
   * next reload.
   */
  const confirmCancel = async () => {
    const target = pendingCancel;
    if (target === null) return;

    setCancelling(true);
    try {
      await apiFetch(
        `/api/reservations/${encodeURIComponent(target.id)}/cancel`,
        { method: "POST" },
      );
      setRows((current) =>
        current.map((row) =>
          row.id === target.id ? { ...row, status: "Cancelled" } : row,
        ),
      );
      setPendingCancel(null);
      toast.success(`${target.id} cancelled.`);
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : `Couldn't cancel ${target.id}. Try again.`,
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="relative px-3 py-5 md:px-12 md:py-9">
      <div className="relative grid grid-cols-1 items-start gap-6 md:grid-cols-[340px_1fr]">
        <aside className="min-w-0 rounded-card bg-background px-[22px] py-[26px]">
          <h2 className="mb-5 text-lg font-semibold text-gray-1">Filters</h2>
          <div className="flex flex-col gap-2">
            {TRIP_WINDOWS.map((option) => {
              const active = window === option;
              const Icon = TRIP_WINDOW_ICONS[option];
              return (
                <button
                  key={option}
                  type="button"
                  // `aria-pressed`, not `aria-current`: these are toggle buttons
                  // filtering a list in place, not links to the current location.
                  aria-pressed={active}
                  onClick={() => setWindow(option)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3.5 rounded-field border-0 px-[18px] py-3.5 text-left text-[1.0625rem] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    active
                      ? "bg-brand font-semibold text-primary-foreground"
                      : "bg-background text-gray-1 hover:bg-gray-5",
                  )}
                >
                  <Icon aria-hidden="true" className="size-[18px] flex-none" />
                  <span>{TRIP_WINDOW_LABELS[option]}</span>
                  <span className="ml-auto text-sm opacity-75">
                    {counts[option]}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-[22px] text-xs text-gray-2">
            Pending requests can be edited or cancelled. Once approved, a
            request can still be cancelled, but no longer edited.
          </p>
        </aside>

        <div className="min-h-[520px] min-w-0 rounded-card bg-background px-3.5 py-[18px] md:px-6 md:py-[26px]">
          <div className="mb-[22px] flex flex-wrap justify-end gap-3">
            {MANAGE_MODES.map((option) => {
              const active = mode === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMode(option)}
                  className={cn(
                    "cursor-pointer rounded-pill border-[1.5px] px-7 py-3.5 text-body font-semibold transition-[filter] hover:brightness-105 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    active
                      ? "border-brand bg-brand text-primary-foreground"
                      : "border-primary bg-background text-primary",
                  )}
                >
                  {MANAGE_MODE_LABELS[option]}
                </button>
              );
            })}
          </div>

          {visible.length > 0 ? (
            <BookingsTable
              rows={visible}
              onCancel={setPendingCancel}
              onDownload={(row) =>
                toast(`Summary for ${row.id} queued.`, {
                  description: "Downloads arrive with the reporting slice.",
                })
              }
            />
          ) : (
            <EmptyState
              title={
                window === "past" ? "No past trips yet" : "Nothing booked yet"
              }
              body={
                window === "past"
                  ? "Completed and cancelled trips will appear here once your upcoming bookings have run."
                  : "Requests you submit show up here with their approval status."
              }
            />
          )}
        </div>
      </div>

      {pendingCancel !== null && (
        <CancelDialog
          row={pendingCancel}
          busy={cancelling}
          onKeep={() => setPendingCancel(null)}
          onConfirm={() => void confirmCancel()}
        />
      )}
    </div>
  );
}

/**
 * Cancellation confirmation.
 *
 * A native `<dialog>` driven by `showModal()`, not the design's fixed-position
 * overlay div. The distinction is the whole reason to use the element: only
 * `showModal()` produces a real modal — focus trapped inside, the rest of the
 * page marked inert, Escape wired to `cancel`, and focus restored to the trigger
 * on close. Rendering `<dialog open>` instead looks identical and delivers none
 * of it, which is a trap worth naming: the attribute is the non-modal form.
 *
 * The backdrop is styled through the `::backdrop` pseudo-element (Tailwind's
 * `backdrop:` variant) rather than a wrapper, so the browser owns the layering.
 *
 * No `autoFocus`: `showModal()` focuses the first focusable child, which is
 * "Keep it" — the non-destructive action, which is where a confirmation should
 * land.
 */
function CancelDialog({
  row,
  busy,
  onKeep,
  onConfirm,
}: {
  row: ReservationRow;
  busy: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="cancel-dialog-title"
      // Fires on Escape. The parent unmounts this component, which closes it.
      onCancel={onKeep}
      className="m-auto w-full max-w-[440px] rounded-card bg-background px-8 py-[30px] backdrop:bg-[color-mix(in_srgb,var(--color-gray-1)_45%,transparent)]"
    >
      <h3
        id="cancel-dialog-title"
        className="mb-2.5 text-[1.375rem] font-semibold text-plum"
      >
        Cancel this booking?
      </h3>
      <p className="mb-6 text-body text-pretty text-gray-2">
        {row.status === "Approved" ? (
          <>
            {row.id} is already approved — a driver and van are assigned and
            will be freed. This cannot be undone.
          </>
        ) : (
          <>
            {row.id} on {formatPlainDate(row.startDate) ?? row.startDate} will
            be withdrawn. You can book a new request instead.
          </>
        )}
      </p>
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onKeep}
          className="cursor-pointer rounded-pill border-[1.5px] border-gray-4 bg-background px-6 py-3.5 text-body font-semibold text-gray-1 hover:border-gray-3 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="cursor-pointer rounded-pill bg-error px-6 py-3.5 text-body font-semibold text-primary-foreground transition-[filter] hover:brightness-110 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-error disabled:cursor-not-allowed disabled:opacity-70"
        >
          {busy ? "Cancelling…" : "Cancel booking"}
        </button>
      </div>
    </dialog>
  );
}
