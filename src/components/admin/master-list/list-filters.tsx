"use client";

import { Search } from "lucide-react";
import { useId } from "react";
import {
  FOCUS_RING,
  FOCUS_RING_INSET,
  PILL_BASE,
  PILL_ON,
} from "@/components/admin/admin-theme";
import { cn } from "@/lib/utils";
import {
  ADMIN_TAB_LABELS,
  ADMIN_TABS,
  type AdminFilter,
  ALL,
  type ModeFilter,
  type SiteFilter,
} from "@/modules/reservations/admin-filters";
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
  RIDE_MODE_LABELS,
  RIDE_MODES,
  SITE_LOCATIONS,
} from "@/modules/reservations/types";

interface ListFiltersProps {
  filter: AdminFilter;
  onChange: (next: AdminFilter) => void;
  /** Shown beside the Pending tab so the queue's size is visible unopened. */
  pendingCount: number;
}

const SITE_OPTIONS: SiteFilter[] = [...SITE_LOCATIONS, ALL];
const MODE_OPTIONS: ModeFilter[] = [...RIDE_MODES, ALL];

/**
 * The master list's filter rail: two tabs, a site filter, search, and a
 * ride-mode filter.
 *
 * Every control is a toggle button carrying `aria-pressed`, not `aria-current`
 * — matching the requestor's manage filters. They rearrange a list in place;
 * `aria-current` announces the current item in a set of navigation targets, and
 * nothing here navigates. A `tablist` would be the other defensible reading of
 * the tabs, but it promises arrow-key movement between them, and promising
 * keyboard behaviour that is not implemented is worse than the plainer role.
 *
 * The design's "Select Date" button is not built. It opens a date picker that
 * filters by range, and the design wires it to a toast saying the picker is out
 * of scope — a control that looks operable and does nothing reads as broken, so
 * it is left out until the range filter is real rather than drawn inert.
 */
export function ListFilters({
  filter,
  onChange,
  pendingCount,
}: ListFiltersProps) {
  const searchId = useId();

  const set = (patch: Partial<AdminFilter>) =>
    onChange({ ...filter, ...patch });

  return (
    <>
      <div className="flex gap-8 border-b border-gray-6 px-5 pt-5 md:px-7">
        {ADMIN_TABS.map((tab) => (
          <TabButton
            key={tab}
            label={ADMIN_TAB_LABELS[tab]}
            active={filter.tab === tab}
            badge={tab === "pending" ? pendingCount : null}
            onSelect={() => set({ tab })}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3.5 px-5 py-5 md:px-7">
        <div className="flex flex-wrap gap-2">
          {SITE_OPTIONS.map((site) => (
            <button
              key={site}
              type="button"
              aria-pressed={filter.site === site}
              onClick={() => set({ site })}
              className={cn(
                "cursor-pointer rounded-field border-0 px-6 py-3 text-body whitespace-nowrap transition-[filter] hover:brightness-[0.97]",
                FOCUS_RING,
                filter.site === site
                  ? "bg-brand font-semibold text-primary-foreground"
                  : "bg-gray-5 font-normal text-gray-2",
              )}
            >
              {site}
            </button>
          ))}
        </div>

        <div className="flex min-w-[240px] max-w-[420px] flex-1 items-center gap-3 rounded-pill border border-gray-4 px-5 py-3 focus-within:border-primary">
          <Search aria-hidden="true" className="size-4 flex-none text-gray-3" />
          <label htmlFor={searchId} className="sr-only">
            Search requests by reference, requestor, site or stop
          </label>
          <input
            id={searchId}
            type="search"
            value={filter.query}
            onChange={(event) => set({ query: event.target.value })}
            placeholder="Search requests"
            className="min-w-0 flex-1 border-0 bg-transparent text-body outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-3 md:ml-auto">
          {MODE_OPTIONS.map((mode) => {
            const active = filter.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={active}
                onClick={() => set({ mode })}
                className={cn(
                  PILL_BASE,
                  "font-semibold",
                  active
                    ? PILL_ON
                    : "border-primary bg-background text-primary hover:brightness-105",
                )}
              >
                {mode === ALL ? ALL : RIDE_MODE_LABELS[mode].title}
              </button>
            );
          })}
        </div>
      </div>

      {filter.tab === "all" && (
        <StatusFilter
          selected={filter.statuses}
          onChange={(statuses) => set({ statuses })}
        />
      )}
    </>
  );
}

/**
 * Which statuses the Master List shows.
 *
 * A `<fieldset>` with an off-screen `<legend>`: five unlabelled toggles in a row
 * announce as nothing, and the group needs a name before its members mean
 * anything. Rendered only on the Master List — the Pending tab IS the pending
 * queue, and a status control there could empty the one tab that exists never
 * to be empty.
 */
function StatusFilter({
  selected,
  onChange,
}: {
  selected: readonly ReservationStatus[];
  onChange: (next: ReservationStatus[]) => void;
}) {
  const toggle = (status: ReservationStatus) =>
    onChange(
      selected.includes(status)
        ? selected.filter((candidate) => candidate !== status)
        : [...selected, status],
    );

  return (
    <fieldset className="flex flex-wrap items-center gap-2 border-0 px-5 pb-5 md:px-7">
      <legend className="sr-only">Filter by status</legend>
      {RESERVATION_STATUSES.map((status) => {
        const active = selected.includes(status);
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(status)}
            className={cn(
              "cursor-pointer rounded-field border-0 px-5 py-2.5 text-sm whitespace-nowrap transition-[filter] hover:brightness-[0.97]",
              FOCUS_RING,
              active
                ? "bg-brand font-semibold text-primary-foreground"
                : "bg-gray-5 font-normal text-gray-2",
            )}
          >
            {status}
          </button>
        );
      })}

      {/* Five statuses is enough that toggling them one at a time is tedious,
          and Clear makes the empty state reachable deliberately rather than
          only by accident. */}
      <button
        type="button"
        onClick={() => onChange([...RESERVATION_STATUSES])}
        className={cn(
          "ml-2 cursor-pointer border-0 bg-transparent text-sm font-semibold text-brand underline-offset-4 hover:underline",
          FOCUS_RING,
        )}
      >
        Select all
      </button>
      <button
        type="button"
        onClick={() => onChange([])}
        className={cn(
          "cursor-pointer border-0 bg-transparent text-sm font-semibold text-gray-2 underline-offset-4 hover:underline",
          FOCUS_RING,
        )}
      >
        Clear
      </button>
    </fieldset>
  );
}

function TabButton({
  label,
  active,
  badge,
  onSelect,
}: {
  label: string;
  active: boolean;
  badge: number | null;
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
      {badge !== null && badge > 0 && (
        // The count is inside the button's accessible name, so the tab announces
        // as "Pending Request, 3 awaiting" rather than leaving a bare number for
        // a screen reader to read as part of the label with no context.
        <span className="rounded-pill bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand">
          {badge}
          <span className="sr-only"> awaiting approval</span>
        </span>
      )}
    </button>
  );
}
