"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ADMIN_CARD, ADMIN_PAGE } from "@/components/admin/admin-theme";
import { ListFilters } from "@/components/admin/master-list/list-filters";
import {
  EmptyRequests,
  RequestTable,
} from "@/components/admin/master-list/request-table";
import type { DecisionResult } from "@/components/admin/trip-drawer/trip-drawer";
import { useTripDrawer } from "@/components/admin/trip-drawer/trip-drawer-host";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ApiError, apiFetch } from "@/lib/api-fetcher";
import {
  type AdminFilter,
  type AdminSort,
  blankAdminFilter,
  filterAdminRequests,
  pendingCount,
  type SortColumn,
  sortAdminRequests,
} from "@/modules/reservations/admin-filters";
import { ADMIN_RESERVATIONS_KEY } from "@/modules/reservations/query-keys";
import type { ReservationRow } from "@/modules/reservations/types";

/** The three direct row actions that skip the drawer and confirm in place. */
type PendingAction =
  | { kind: "cancel"; row: ReservationRow }
  | { kind: "noShow"; row: ReservationRow }
  | { kind: "revertNoShow"; row: ReservationRow };

interface MasterListViewProps {
  initialRows: ReservationRow[];
  adminName: string;
}

/** Sorted newest-first on first click; the rest read better ascending. */
const DATE_COLUMNS: ReadonlySet<SortColumn> = new Set<SortColumn>([
  "submittedAt",
  "startDate",
  "updatedAt",
]);

/**
 * The master list: filters, the requests table, and the review drawer.
 *
 * `TripDrawer` owns the write and invalidates both this list and its own detail
 * on every successful save, so the table re-reads the server rather than
 * patching a local copy.
 *
 * It used to patch: `applyDecision` wrote `status` and `updatedBy` into a
 * `useState` snapshot of `initialRows` and nothing else. Every other column the
 * save had changed — the driver, the van, the plate, the trip details — kept
 * showing its pre-save value until the router cache expired minutes later, so
 * approving a request produced a row that said Approved with an empty driver
 * while the drawer for that same request showed the driver assigned. A
 * field-only save (assign a van, decide nothing) never reached the patch at all
 * and repainted nothing.
 *
 * The rule that replaces it: the server's rows are the only copy. `initialData`
 * is the server-rendered page, so this costs no extra fetch on load — the
 * 30-second `staleTime` in `query-client.ts` means nothing refetches until
 * something invalidates.
 */
export function MasterListView({
  initialRows,
  adminName,
}: MasterListViewProps) {
  const [filter, setFilter] = useState<AdminFilter>(blankAdminFilter);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [actionBusy, setActionBusy] = useState(false);
  const queryClient = useQueryClient();

  // `initialData`, not `useState`: the page already fetched these rows
  // server-side, and seeding the cache with them means the list is queryable —
  // and so invalidatable — without a second request on load. The endpoint
  // scopes itself from the session, so an admin gets every row here exactly as
  // the page did.
  const { data: rows } = useQuery({
    queryKey: ADMIN_RESERVATIONS_KEY,
    queryFn: () => apiFetch<ReservationRow[]>("/api/reservations"),
    initialData: initialRows,
  });

  const visible = sortAdminRequests(
    filterAdminRequests(rows, filter),
    filter.sort[filter.tab],
  );
  const awaiting = pendingCount(rows, filter.site);

  /**
   * Flip the direction when the column is already active; otherwise adopt that
   * column's natural direction — newest-first for a date, A-Z for a name or a
   * lifecycle position. Clicking "Requestor" and landing on Z-A would read as
   * a bug rather than a choice.
   */
  const sortBy = (column: SortColumn) => {
    const current = filter.sort[filter.tab];
    const direction: AdminSort["direction"] =
      current.column === column
        ? current.direction === "asc"
          ? "desc"
          : "asc"
        : DATE_COLUMNS.has(column)
          ? "desc"
          : "asc";
    setFilter({
      ...filter,
      sort: { ...filter.sort, [filter.tab]: { column, direction } },
    });
  };

  // Announces the decision only. The rows themselves come back from the
  // invalidation the drawer fires — patching them here as well would recreate
  // the two-copies-disagreeing bug this callback used to cause.
  const announceDecision = (result: DecisionResult) => {
    toast.success(`${result.id} ${result.status.toLowerCase()}.`);
  };

  /**
   * Cancel, Mark No Show and Revert to Approved all skip the drawer — they
   * are one-step confirmations, not an edit — so they invalidate the list
   * directly rather than going through `onDecided`.
   */
  const confirmPendingAction = async () => {
    if (pendingAction === null) return;
    const { kind, row } = pendingAction;
    const id = encodeURIComponent(row.id);

    setActionBusy(true);
    try {
      if (kind === "cancel") {
        await apiFetch(`/api/reservations/${id}/cancel`, { method: "POST" });
      } else if (kind === "noShow") {
        await apiFetch(`/api/reservations/${id}/no-show`, { method: "POST" });
      } else {
        await apiFetch(`/api/reservations/${id}/no-show`, {
          method: "DELETE",
        });
      }

      void queryClient.invalidateQueries({ queryKey: ADMIN_RESERVATIONS_KEY });
      toast.success(successMessage(kind, row));
      setPendingAction(null);
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Something went wrong. Try again.",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const { openId, openFor, drawer } = useTripDrawer({
    adminName,
    onDecided: announceDecision,
  });

  return (
    <div className={ADMIN_PAGE}>
      <div className={`${ADMIN_CARD} min-h-[640px] pb-6`}>
        <ListFilters
          filter={filter}
          onChange={setFilter}
          pendingCount={awaiting}
        />

        {visible.length > 0 ? (
          <RequestTable
            rows={visible}
            tab={filter.tab}
            openId={openId}
            onOpen={(row) => openFor(row.id)}
            onDecide={(row, decision) => openFor(row.id, { decision })}
            onReassign={(row) => openFor(row.id, { mode: "reassign" })}
            onCancel={(row) => setPendingAction({ kind: "cancel", row })}
            onNoShow={(row) => setPendingAction({ kind: "noShow", row })}
            onRevertNoShow={(row) =>
              setPendingAction({ kind: "revertNoShow", row })
            }
            sort={filter.sort[filter.tab]}
            onSort={sortBy}
          />
        ) : (
          <EmptyRequests title={emptyTitle(filter)} body={emptyBody(filter)} />
        )}
      </div>

      {drawer}

      {pendingAction !== null && (
        <ConfirmDialog
          {...dialogCopyFor(pendingAction)}
          busy={actionBusy}
          onKeep={() => setPendingAction(null)}
          onConfirm={confirmPendingAction}
        />
      )}
    </div>
  );
}

/** The reference this action names, e.g. `"VR-2026-000123 will be…"`. */
function successMessage(
  kind: PendingAction["kind"],
  row: ReservationRow,
): string {
  if (kind === "cancel") return `${row.id} cancelled.`;
  if (kind === "noShow") return `${row.id} marked as a no-show.`;
  return `${row.id} reverted to Approved.`;
}

/**
 * Title, body and button copy for each of the three direct actions.
 *
 * Cancel and Mark No Show are styled `destructive` (red confirm button) —
 * Cancel because it genuinely cannot be undone, Mark No Show because it is a
 * consequential call even though it has its own way back. Revert stays the
 * default brand styling: it is a correction, not a decision to flag.
 */
function dialogCopyFor(action: PendingAction): {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  confirmingLabel: string;
  tone: "destructive" | "default";
} {
  const { row } = action;
  if (action.kind === "cancel") {
    return {
      title: "Cancel this trip?",
      body: (
        <>
          {row.id} will be cancelled and its requestor notified. Any assigned
          driver and van will be freed. This cannot be undone.
        </>
      ),
      confirmLabel: "Cancel trip",
      confirmingLabel: "Cancelling…",
      tone: "destructive",
    };
  }
  if (action.kind === "noShow") {
    return {
      title: "Mark this trip as a No Show?",
      body: (
        <>
          {row.id} will be marked as a No Show and its requestor notified. This
          cannot be undone from here, though a no-show can be reverted back to
          Approved afterward if the passenger turns up late.
        </>
      ),
      confirmLabel: "Mark No Show",
      confirmingLabel: "Marking…",
      tone: "destructive",
    };
  }
  return {
    title: "Revert to Approved?",
    body: (
      <>{row.id} will be set back to Approved and its requestor notified.</>
    ),
    confirmLabel: "Revert to Approved",
    confirmingLabel: "Reverting…",
    tone: "default",
  };
}

function emptyTitle(filter: AdminFilter): string {
  if (filter.tab === "all" && filter.statuses.length === 0) {
    return "No statuses selected";
  }
  if (filter.query.trim() !== "") return "No matches";
  return filter.tab === "pending"
    ? "Nothing awaiting approval"
    : "No requests here";
}

function emptyBody(filter: AdminFilter): string {
  if (filter.tab === "all" && filter.statuses.length === 0) {
    return "Pick at least one status to see requests.";
  }
  if (filter.query.trim() !== "") {
    return `Nothing matches “${filter.query.trim()}” in this view. Clear the search, or widen the site and van filters.`;
  }
  return filter.tab === "pending"
    ? "New requests land here as associates submit them. Check the site and van filters if you expected rows."
    : "Requests appear here once they have been submitted. Check the site and van filters if you expected rows.";
}
