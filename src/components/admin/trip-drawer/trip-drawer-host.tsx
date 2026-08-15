"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type DecisionResult,
  TripDrawer,
  type TripDrawerMode,
} from "@/components/admin/trip-drawer/trip-drawer";
import { apiFetch } from "@/lib/api-fetcher";
import type { Decision } from "@/modules/reservations/decision";
import { reservationDetailKey } from "@/modules/reservations/query-keys";
import type { ReservationDetail } from "@/modules/reservations/types";

interface OpenDrawer {
  id: string;
  decision: Decision | null;
  mode: TripDrawerMode;
}

export interface TripDrawerHost {
  /** The reference whose drawer is open, for highlighting its row or block. */
  openId: string | null;
  openFor: (
    reference: string,
    options?: { decision?: Decision | null; mode?: TripDrawerMode },
  ) => void;
  close: () => void;
  /** Render this. Null when nothing is open. */
  drawer: ReactNode;
}

/**
 * Owns everything around the trip drawer: the detail query, the loading dialog,
 * the error toast, and the mount itself.
 *
 * Extracted from `MasterListView` so the calendar opens the SAME drawer rather
 * than a second copy that drifts from it. Behaviour is unchanged — the master
 * list's tests pass against this untouched, which is what proves the move was
 * faithful.
 */
export function useTripDrawer(options: {
  adminName: string;
  onDecided: (result: DecisionResult) => void;
}): TripDrawerHost {
  const [open, setOpen] = useState<OpenDrawer | null>(null);

  // The drawer's detail is fetched when a row opens — the same rows/detail
  // consistency the fixture gave for free now comes from both reading one
  // database. staleTime: 0 is explicit and load-bearing, not redundant with
  // the global default: query-client.ts sets 30s, and a decision changes the
  // detail, so reopening must refetch rather than skip the refetch entirely.
  // It does not guarantee fresh data on screen — gcTime is the 5m default, so
  // a reopen paints the cached row first and updates when the refetch lands.
  // retry: false so a failing fetch surfaces promptly instead of after React
  // Query's three built-in retries.
  const detailQuery = useQuery({
    queryKey: reservationDetailKey(open?.id),
    queryFn: () => apiFetch<ReservationDetail>(`/api/reservations/${open?.id}`),
    enabled: open !== null,
    staleTime: 0,
    retry: false,
  });
  const detail = open === null ? null : (detailQuery.data ?? null);

  useEffect(() => {
    if (open !== null && detailQuery.isError) {
      toast.error("Couldn't load trip details. Try again.");
      setOpen(null);
    }
  }, [open, detailQuery.isError]);

  const drawer =
    open === null ? null : detail !== null ? (
      <TripDrawer
        // Remounts when the reference changes, so a second request opened
        // from the same list starts with a clean draft rather than inheriting
        // the previous one's unsaved edits.
        key={detail.id}
        detail={detail}
        adminName={options.adminName}
        initialDecision={open.decision}
        mode={open.mode}
        onClose={() => setOpen(null)}
        onDecided={options.onDecided}
      />
    ) : (
      <DetailDrawerLoading onClose={() => setOpen(null)} />
    );

  return {
    openId: open?.id ?? null,
    openFor: (reference, opts = {}) =>
      setOpen({
        id: reference,
        decision: opts.decision ?? null,
        mode: opts.mode ?? "decide",
      }),
    close: () => setOpen(null),
    drawer,
  };
}

/**
 * Stands in for `TripDrawer` while its detail fetch is in flight, so a row
 * click gets an immediate visible response instead of silence until the
 * fetch resolves. Same dialog shell and backdrop as `TripDrawer` so opening
 * a row does not jump between two different panel shapes.
 */
function DetailDrawerLoading({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Loading trip details"
      onCancel={onClose}
      className="m-0 ml-auto flex h-dvh max-h-none w-full max-w-[620px] items-center justify-center bg-background backdrop:bg-[color-mix(in_srgb,var(--color-gray-1)_35%,transparent)]"
    >
      <span
        aria-hidden="true"
        className="size-6 animate-spin rounded-full border-2 border-gray-4 border-t-brand"
      />
      <span className="sr-only">Loading trip details…</span>
    </dialog>
  );
}
