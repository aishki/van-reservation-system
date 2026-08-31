"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  ADMIN_CARD,
  ADMIN_PAGE,
  BUTTON_PRIMARY,
  FOCUS_RING,
  FOCUS_RING_INSET,
} from "@/components/admin/admin-theme";
import { AdminForm } from "@/components/admin/roster/admin-form";
import { DeactivateDialog } from "@/components/admin/roster/deactivate-dialog";
import { DriverForm } from "@/components/admin/roster/driver-form";
import { VanForm } from "@/components/admin/roster/van-form";
import { ApiError, apiFetch } from "@/lib/api-fetcher";
import { EM_DASH } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { AdminEntry } from "@/modules/admins/types";
import type { Driver } from "@/modules/drivers/types";
import type { Van } from "@/modules/vans/types";

export const ROSTER_TABS = ["drivers", "vans", "admins"] as const;
export type RosterTab = (typeof ROSTER_TABS)[number];

const ROSTER_TAB_LABELS: Record<RosterTab, string> = {
  drivers: "Drivers",
  vans: "Vans",
  admins: "Admins",
};

/** Singular noun for the Add/Edit dialog's title and the empty state. */
const ROSTER_TAB_SINGULAR: Record<RosterTab, string> = {
  drivers: "driver",
  vans: "van",
  admins: "admin",
};

/** Where each tab's CRUD lives — see Tasks 9 and 10. */
const RESOURCE_PATH: Record<RosterTab, string> = {
  drivers: "/api/drivers",
  vans: "/api/vans",
  admins: "/api/admins",
};

interface RosterViewProps {
  drivers: Driver[];
  vans: Van[];
  admins: AdminEntry[];
  adminName: string;
  /** Cosmetic only — hides the Admins tab. The routes re-check on every write. */
  superAdmin: boolean;
  /**
   * Manila's today, computed on the server. Accepted for parity with the other
   * admin views' props shape; nothing on this screen is date-driven yet.
   */
  today: string;
}

/**
 * What is being added or edited: the tab decides which form Task 13 mounts,
 * and `row` is the full record — `null` for Add, the actual `Driver` / `Van` /
 * `AdminEntry` for Edit — so a form can prefill without this host stripping
 * fields down to what only ITS code happens to need.
 */
interface EditingState {
  tab: RosterTab;
  row: Driver | Van | AdminEntry | null;
}

/**
 * A pending Deactivate on a driver or van, waiting on `DeactivateDialog`'s
 * warning. Admins carry no such state — deactivating one has no "affected
 * trips" concept, since an admin is never assigned to a reservation — so an
 * admin Deactivate goes straight to `toggleActive`, same as every Reactivate.
 */
interface DeactivatingState {
  target: "driver" | "van";
  tab: "drivers" | "vans";
  id: string;
  /** Whatever the row's own table shows first — a driver's name, a van's number. */
  name: string;
}

/**
 * The roster surface: three tabs (a fourth, hidden, for non-super-admins), one
 * table per tab, and the Add/Edit dialog host the forms in Task 13 mount into.
 *
 * Each tab's rows are seeded from the server-rendered page via `initialData` —
 * same pattern as `MasterListView` — so mounting costs no extra fetch, and a
 * mutation's invalidation is what makes the table re-read the server rather
 * than a hand-patched local copy.
 */
export function RosterView({
  drivers,
  vans,
  admins,
  superAdmin,
}: RosterViewProps) {
  const [tab, setTab] = useState<RosterTab>("drivers");
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [deactivating, setDeactivating] = useState<DeactivatingState | null>(
    null,
  );
  const queryClient = useQueryClient();

  const driversQuery = useQuery({
    queryKey: ["roster", "drivers"],
    queryFn: () => apiFetch<Driver[]>("/api/drivers"),
    initialData: drivers,
  });
  const vansQuery = useQuery({
    queryKey: ["roster", "vans"],
    queryFn: () => apiFetch<Van[]>("/api/vans"),
    initialData: vans,
  });
  // Disabled for a non-super-admin: the Admins tab is not just hidden, the
  // list itself is never requested — see Task 11's page.tsx.
  const adminsQuery = useQuery({
    queryKey: ["roster", "admins"],
    queryFn: () => apiFetch<AdminEntry[]>("/api/admins"),
    initialData: admins,
    enabled: superAdmin,
  });

  const toggleActive = useMutation({
    mutationFn: ({
      tab: target,
      id,
      active,
    }: {
      tab: RosterTab;
      id: string;
      active: boolean;
    }) =>
      apiFetch(`${RESOURCE_PATH[target]}/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["roster", variables.tab] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't save that change. Try again.",
      );
    },
  });

  // The one callback every form gets: it closes the dialog AND invalidates,
  // whether the click that triggered it was Save or Cancel. Invalidating on a
  // cancel is a wasted refetch of data that did not change, not a bug — it
  // keeps the form's contract to exactly `{ row, onDone }`, with no separate
  // onClose the host would otherwise have to hand each of three forms.
  const finishEditing = () => {
    if (editing !== null) {
      queryClient.invalidateQueries({ queryKey: ["roster", editing.tab] });
    }
    setEditing(null);
  };

  // Deactivating a driver or van goes through the warning dialog; every other
  // toggle (Reactivate, and any change to an admin row) has no "affected
  // trips" to warn about and applies immediately.
  const handleDriverToggle = (row: Driver) => {
    if (row.active) {
      setDeactivating({
        target: "driver",
        tab: "drivers",
        id: row.id,
        name: row.name,
      });
      return;
    }
    toggleActive.mutate({ tab: "drivers", id: row.id, active: true });
  };
  const handleVanToggle = (row: Van) => {
    if (row.active) {
      setDeactivating({
        target: "van",
        tab: "vans",
        id: row.id,
        name: row.vanNumber,
      });
      return;
    }
    toggleActive.mutate({ tab: "vans", id: row.id, active: true });
  };
  const handleAdminToggle = (row: AdminEntry) => {
    toggleActive.mutate({ tab: "admins", id: row.id, active: !row.active });
  };

  const visibleTabs = ROSTER_TABS.filter((candidate) =>
    candidate === "admins" ? superAdmin : true,
  );

  return (
    <div className={ADMIN_PAGE}>
      <div className={`${ADMIN_CARD} min-h-[640px] pb-6`}>
        <div className="flex items-center justify-between gap-4 border-b border-gray-6 px-5 pt-5 md:px-7">
          <div className="flex gap-8">
            {visibleTabs.map((candidate) => (
              <TabButton
                key={candidate}
                label={ROSTER_TAB_LABELS[candidate]}
                active={tab === candidate}
                onSelect={() => setTab(candidate)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setEditing({ tab, row: null })}
            className={cn(BUTTON_PRIMARY, "mb-3 px-6 py-2.5 text-body")}
          >
            Add {ROSTER_TAB_SINGULAR[tab]}
          </button>
        </div>

        <div className="px-5 py-5 md:px-7">
          {tab === "drivers" && (
            <DriversTable
              rows={driversQuery.data}
              onEdit={(row) => setEditing({ tab: "drivers", row })}
              onToggleActive={handleDriverToggle}
            />
          )}
          {tab === "vans" && (
            <VansTable
              rows={vansQuery.data}
              onEdit={(row) => setEditing({ tab: "vans", row })}
              onToggleActive={handleVanToggle}
            />
          )}
          {tab === "admins" && superAdmin && (
            <AdminsTable
              rows={adminsQuery.data}
              onEdit={(row) => setEditing({ tab: "admins", row })}
              onToggleActive={handleAdminToggle}
            />
          )}
        </div>
      </div>

      {/* `editing.row`'s cast below is safe: `setEditing` always pairs a tab
          with the row type that tab's table produced (`onEdit` above, or
          `null` from the Add button) — the union in `EditingState` exists so
          the host does not need to know which form each tab wants, not
          because the pairing is ever actually mixed. */}
      {editing !== null && editing.tab === "drivers" && (
        <DriverForm row={editing.row as Driver | null} onDone={finishEditing} />
      )}
      {editing !== null && editing.tab === "vans" && (
        <VanForm row={editing.row as Van | null} onDone={finishEditing} />
      )}
      {editing !== null && editing.tab === "admins" && (
        <AdminForm
          row={editing.row as AdminEntry | null}
          onDone={finishEditing}
        />
      )}

      {deactivating !== null && (
        <DeactivateDialog
          target={deactivating.target}
          id={deactivating.id}
          name={deactivating.name}
          onCancel={() => setDeactivating(null)}
          onConfirm={() => {
            toggleActive.mutate({
              tab: deactivating.tab,
              id: deactivating.id,
              active: false,
            });
            setDeactivating(null);
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 border-0 border-b-[3px] bg-transparent px-0.5 pt-2.5 pb-3.5 text-[1.0625rem] whitespace-nowrap",
        FOCUS_RING_INSET,
        active
          ? "border-b-brand font-semibold text-brand"
          : "border-b-transparent font-normal text-gray-2 hover:text-brand",
      )}
    >
      {label}
    </button>
  );
}

/** "Active" / "Inactive" — never hidden, since an old trip still names its driver. */
function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-block rounded-pill px-3.5 py-1.5 text-sm font-semibold",
        active ? "bg-success-tint text-success" : "bg-gray-5 text-gray-2",
      )}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function RowActions({
  active,
  onEdit,
  onToggleActive,
}: {
  active: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onEdit}
        className={cn(
          "cursor-pointer rounded-pill border-0 bg-gray-5 px-4 py-2 text-sm font-semibold text-gray-1 hover:brightness-[0.97]",
          FOCUS_RING,
        )}
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onToggleActive}
        className={cn(
          "cursor-pointer rounded-pill border-0 px-4 py-2 text-sm font-semibold",
          active
            ? "bg-error-tint text-error hover:brightness-[0.97]"
            : "bg-brand-tint text-brand hover:brightness-[0.97]",
          FOCUS_RING,
        )}
      >
        {active ? "Deactivate" : "Reactivate"}
      </button>
    </div>
  );
}

function TableShell({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <section
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-reachable scroll container, matches RequestTable
      tabIndex={0}
      aria-label="Roster, scrollable horizontally"
      className="max-w-full min-w-0 overflow-x-auto focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-primary"
    >
      <table className="w-full min-w-[900px] border-collapse tabular-nums">
        <thead>
          <tr>
            {headers.map((label) => (
              <th
                key={label}
                scope="col"
                className="border-b border-gray-4 px-4 py-3.5 text-left text-body font-semibold whitespace-nowrap text-gray-1"
              >
                {label}
              </th>
            ))}
            <th scope="col" className="border-b border-gray-4 px-4 py-3.5" />
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}

function DriversTable({
  rows,
  onEdit,
  onToggleActive,
}: {
  rows: Driver[];
  onEdit: (row: Driver) => void;
  onToggleActive: (row: Driver) => void;
}) {
  return (
    <TableShell headers={["Name", "Mobile", "Site", "Shift", "Status"]}>
      {rows.map((row) => (
        <tr key={row.id} className="border-b border-gray-6">
          <th
            scope="row"
            className="px-4 py-4 text-left text-body font-normal whitespace-nowrap text-gray-1"
          >
            {row.name}
          </th>
          <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
            {row.mobile}
          </td>
          <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
            {row.site}
          </td>
          <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
            {row.shift ?? EM_DASH}
          </td>
          <td className="px-4 py-4 whitespace-nowrap">
            <ActiveBadge active={row.active} />
          </td>
          <td className="px-4 py-4">
            <RowActions
              active={row.active}
              onEdit={() => onEdit(row)}
              onToggleActive={() => onToggleActive(row)}
            />
          </td>
        </tr>
      ))}
    </TableShell>
  );
}

function VansTable({
  rows,
  onEdit,
  onToggleActive,
}: {
  rows: Van[];
  onEdit: (row: Van) => void;
  onToggleActive: (row: Van) => void;
}) {
  return (
    <TableShell headers={["Van number", "Plate", "Car type", "Site", "Status"]}>
      {rows.map((row) => (
        <tr key={row.id} className="border-b border-gray-6">
          <th
            scope="row"
            className="px-4 py-4 text-left text-body font-normal whitespace-nowrap text-gray-1"
          >
            {row.vanNumber}
          </th>
          <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
            {row.plate}
          </td>
          <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
            {row.carType}
          </td>
          <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
            {row.site}
          </td>
          <td className="px-4 py-4 whitespace-nowrap">
            <ActiveBadge active={row.active} />
          </td>
          <td className="px-4 py-4">
            <RowActions
              active={row.active}
              onEdit={() => onEdit(row)}
              onToggleActive={() => onToggleActive(row)}
            />
          </td>
        </tr>
      ))}
    </TableShell>
  );
}

function displaySite(site: string): string {
  return site.charAt(0).toUpperCase() + site.slice(1);
}

function AdminsTable({
  rows,
  onEdit,
  onToggleActive,
}: {
  rows: AdminEntry[];
  onEdit: (row: AdminEntry) => void;
  onToggleActive: (row: AdminEntry) => void;
}) {
  return (
    <TableShell
      headers={[
        "Name",
        "Email",
        "Domain ID",
        "Site",
        "Notifies",
        "Manages whitelist",
        "Status",
      ]}
    >
      {rows.map((row) => (
        <tr key={row.id} className="border-b border-gray-6">
          <th
            scope="row"
            className="px-4 py-4 text-left text-body font-normal whitespace-nowrap text-gray-1"
          >
            {row.fullName}
          </th>
          <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
            {row.email ?? EM_DASH}
          </td>
          <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
            {row.domainId ?? EM_DASH}
          </td>
          <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
            {displaySite(row.site)}
          </td>
          <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
            {row.notify ? "Yes" : "No"}
          </td>
          <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
            {row.superAdmin ? "Yes" : "No"}
          </td>
          <td className="px-4 py-4 whitespace-nowrap">
            <ActiveBadge active={row.active} />
          </td>
          <td className="px-4 py-4">
            <RowActions
              active={row.active}
              onEdit={() => onEdit(row)}
              onToggleActive={() => onToggleActive(row)}
            />
          </td>
        </tr>
      ))}
    </TableShell>
  );
}
