import { formatPlainMonth, monthOf } from "@/lib/tz";
import {
  RESERVATION_STATUSES,
  type ReservationRow,
  type ReservationStatus,
  type RideMode,
  type SiteLocation,
} from "@/modules/reservations/types";

/**
 * Filtering and counting for the admin surfaces. Pure, so the master list's
 * filter combinations and the dashboard's counts can be tested without
 * rendering a table.
 */

/** The master list's two tabs. `pending` is the review queue; `all` is history. */
export const ADMIN_TABS = ["pending", "all"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export const ADMIN_TAB_LABELS: Record<AdminTab, string> = {
  pending: "Pending Request",
  all: "Master List",
};

/**
 * "All" widens a filter rather than naming a value, so it is spelled as a
 * separate literal instead of being folded into `SiteLocation`. A site is a
 * property a reservation has; "All" is a question the UI asks.
 */
export const ALL = "All" as const;
export type SiteFilter = SiteLocation | typeof ALL;
export type ModeFilter = RideMode | typeof ALL;

export interface AdminFilter {
  tab: AdminTab;
  site: SiteFilter;
  mode: ModeFilter;
  /** Free text; matched case-insensitively against the fields below. */
  query: string;
  /**
   * Which statuses the `all` tab shows. Ignored on `pending`, which is BY
   * DEFINITION the Pending queue — a status filter there could empty the one
   * tab that exists to never be empty.
   */
  statuses: ReservationStatus[];
  /**
   * Kept per tab, not shared. The two tabs answer different questions — the
   * Pending queue is worked oldest-first, the Master List is scanned for what
   * just changed — and one shared setting would make switching tabs silently
   * re-sort the other.
   */
  sort: Record<AdminTab, AdminSort>;
}

export function blankAdminFilter(): AdminFilter {
  return {
    tab: "pending",
    site: ALL,
    mode: ALL,
    query: "",
    // Everything except Pending: the Pending tab is where a reviewer works, so
    // repeating that queue as the Master List's default made the list a
    // duplicate of the tab beside it.
    statuses: RESERVATION_STATUSES.filter((status) => status !== "Pending"),
    sort: {
      // Oldest first: the request that has waited longest is the one to act on.
      pending: { column: "submittedAt", direction: "asc" },
      // Most recently touched first. An admin opens this tab to confirm the
      // decision they just made landed, and it was invisible at the bottom.
      all: { column: "updatedAt", direction: "desc" },
    },
  };
}

/**
 * Fields the search box looks in.
 *
 * Each is tested separately. The design concatenates them into one string and
 * runs a single `indexOf`, which matches text that exists in no field at all:
 * with `from: "AGT"` and `to: "GLS"`, searching `"agt gls"` hits — and so does
 * `"t g"`. A search that invents matches across a boundary is worse than one
 * that misses, because the row it returns looks like a real answer.
 */
function searchableFields(row: ReservationRow): string[] {
  return [
    row.id,
    row.requestor,
    row.site,
    row.from,
    row.to,
    row.purpose,
    row.details,
    row.driver,
    row.vanLabel,
    row.vanPlate,
  ].filter((field): field is string => field !== null);
}

export function matchesQuery(row: ReservationRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return searchableFields(row).some((field) =>
    field.toLowerCase().includes(needle),
  );
}

export function filterAdminRequests(
  rows: readonly ReservationRow[],
  filter: AdminFilter,
): ReservationRow[] {
  return rows.filter((row) => {
    if (filter.tab === "pending" && row.status !== "Pending") return false;
    if (filter.tab === "all" && !filter.statuses.includes(row.status)) {
      return false;
    }
    if (filter.site !== ALL && row.site !== filter.site) return false;
    if (filter.mode !== ALL && row.mode !== filter.mode) return false;
    return matchesQuery(row, filter.query);
  });
}

export const SORT_COLUMNS = [
  "submittedAt",
  "startDate",
  "updatedAt",
  "status",
  "requestor",
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

export interface AdminSort {
  column: SortColumn;
  direction: "asc" | "desc";
}

/** Lifecycle order, so the two approved spellings stay adjacent. */
const STATUS_RANK = new Map(
  RESERVATION_STATUSES.map((status, index) => [status, index]),
);

/** `null` for a value the row has no answer for — see the nulls-last rule. */
function sortKey(
  row: ReservationRow,
  column: SortColumn,
): string | number | null {
  if (column === "status") return STATUS_RANK.get(row.status) ?? 0;
  if (column === "requestor") return row.requestor.toLowerCase();
  if (column === "updatedAt") return row.updatedAt;
  if (column === "startDate") return row.startDate;
  return row.submittedAt;
}

/**
 * Pure, non-mutating and STABLE, so rows that tie keep the order the server
 * sent — `created_at desc`, a meaningful fallback rather than an arbitrary one.
 * `Array.prototype.sort` is stable per spec, so a plain `[...rows].sort()`
 * carries that guarantee.
 *
 * Nulls sort LAST in both directions, never "smallest": a request nobody has
 * touched has no answer to "when was it last updated", and burying it under a
 * descending sort while floating it to the top of an ascending one would be two
 * different lies.
 */
export function sortAdminRequests(
  rows: readonly ReservationRow[],
  sort: AdminSort,
): ReservationRow[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = sortKey(left, sort.column);
    const b = sortKey(right, sort.column);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (a === b) return 0;
    return (a < b ? -1 : 1) * sign;
  });
}

/**
 * How many requests are awaiting a decision, for the topbar's notification
 * count and the tab badge.
 *
 * Scoped by site so an admin filtered to Iloilo is not told about Manila's
 * queue — site is a filter, never a permission boundary, so this is a courtesy
 * and not a restriction.
 */
export function pendingCount(
  rows: readonly ReservationRow[],
  site: SiteFilter = ALL,
): number {
  return rows.filter(
    (row) => row.status === "Pending" && (site === ALL || row.site === site),
  ).length;
}

export interface MonthOption {
  /** `"YYYY-MM"`, or `ALL`. */
  value: string;
  label: string;
  count: number;
}

/**
 * The months the given requests actually fall in, newest first, with `All`
 * first of all — the reports month picker. Derived from the data so no option
 * is empty and no request is unreachable through the filter. The dashboard
 * uses the design's quarter-plus-months control instead, built on
 * `quartersIn`/`monthsOfQuarter`, which keeps the same data-derived guarantee.
 *
 * A row whose `startDate` is unparseable is counted under `All` but gets no
 * month of its own, so it stays visible on the default filter instead of
 * vanishing from every view.
 */
export function monthsIn(rows: readonly ReservationRow[]): MonthOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const month = monthOf(row.startDate);
    if (month === null) continue;
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }

  const months = [...counts.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([value, count]) => ({
      value,
      label: formatPlainMonth(value) ?? value,
      count,
    }));

  return [{ value: ALL, label: "All time", count: rows.length }, ...months];
}

export function filterByMonth(
  rows: readonly ReservationRow[],
  month: string,
): ReservationRow[] {
  if (month === ALL) return [...rows];
  return rows.filter((row) => monthOf(row.startDate) === month);
}

export interface QuarterOption {
  /** `"YYYY-Qn"`. */
  value: string;
  /** `"Q1 2026"`. */
  label: string;
  count: number;
}

/** `"2026-02"` → `"2026-Q1"`. */
function quarterOfMonth(month: string): string {
  const [year, mm] = month.split("-");
  return `${year}-Q${Math.ceil(Number(mm) / 3)}`;
}

/**
 * The quarters the given requests actually fall in, newest first — the
 * dashboard's quarter dropdown. Data-derived for the same reason as
 * `monthsIn`: fixed options are mostly empty, and any request outside them is
 * unreachable through the filter. A row with an unparseable `startDate`
 * belongs to no quarter and is reachable only through All Time.
 */
export function quartersIn(rows: readonly ReservationRow[]): QuarterOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const month = monthOf(row.startDate);
    if (month === null) continue;
    const quarter = quarterOfMonth(month);
    counts.set(quarter, (counts.get(quarter) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([value, count]) => {
      const [year, q] = value.split("-");
      return { value, label: `${q} ${year}`, count };
    });
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface QuarterMonth {
  /** `"YYYY-MM"`. */
  value: string;
  /** Full month name — the quarter label carries the year. */
  label: string;
}

/** The fixed month trio of a `"YYYY-Qn"` quarter; empty for a malformed one. */
export function monthsOfQuarter(quarter: string): QuarterMonth[] {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (match === null) return [];
  const first = (Number(match[2]) - 1) * 3;
  return [0, 1, 2].map((offset) => ({
    value: `${match[1]}-${String(first + offset + 1).padStart(2, "0")}`,
    label: MONTH_NAMES[first + offset],
  }));
}

export function filterByQuarter(
  rows: readonly ReservationRow[],
  quarter: string,
): ReservationRow[] {
  return rows.filter((row) => {
    const month = monthOf(row.startDate);
    return month !== null && quarterOfMonth(month) === quarter;
  });
}

export interface StatusBreakdown {
  counts: Record<ReservationStatus, number>;
  total: number;
}

/**
 * The dashboard's status breakdown.
 *
 * Every status is present with a zero rather than omitted when nothing has it,
 * so the breakdown renders a stable set of rows instead of reflowing as data
 * arrives — and so a status that genuinely has no requests reads as "none",
 * which is information, rather than vanishing.
 */
export function statusBreakdown(
  rows: readonly ReservationRow[],
): StatusBreakdown {
  const counts = Object.fromEntries(
    RESERVATION_STATUSES.map((status) => [status, 0]),
  ) as Record<ReservationStatus, number>;

  for (const row of rows) counts[row.status] += 1;

  return { counts, total: rows.length };
}

/**
 * `share(3, 8)` → `"37.5%"`. Returns `"0%"` for an empty total rather than
 * `NaN%`, which is what dividing by zero renders as.
 *
 * One decimal place, and a whole number when the fraction is exact — "45%" is
 * easier to read than "45.0%", and the extra digit only earns its place when
 * two shares would otherwise look identical.
 */
export function share(count: number, total: number): string {
  if (total <= 0) return "0%";
  const pct = (count / total) * 100;
  return `${Number(pct.toFixed(1))}%`;
}
