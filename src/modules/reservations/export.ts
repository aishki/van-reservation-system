import {
  EM_DASH,
  formatInstant,
  formatPlainDate,
  formatPlainTime,
} from "@/lib/tz";
import {
  ALL,
  type ModeFilter,
  type SiteFilter,
} from "@/modules/reservations/admin-filters";
import {
  type ReservationRow,
  RIDE_MODE_LABELS,
} from "@/modules/reservations/types";

/**
 * Turning a set of reservations into a downloadable file (FR-16).
 *
 * Pure — takes rows, returns a string. The browser half (Blob, object URL) is
 * three lines in the component; the part worth testing is the encoding.
 */

/** Column headers, in the order the master list shows them. */
export const EXPORT_COLUMNS = [
  "Reference",
  "Date Submitted",
  "Start Date",
  "Start Time",
  "End Time",
  "Requestor",
  "Location",
  "From",
  "To",
  "Purpose",
  "Details",
  "Van Type",
  "Driver",
  "Van",
  "Plate Number",
  "Status",
  "Updated By",
  "Last Updated",
] as const;

/**
 * Escape one CSV cell.
 *
 * Two separate problems:
 *
 * 1. **CSV quoting** (RFC 4180). A value containing a comma, a quote or a
 *    newline must be wrapped in quotes with its own quotes doubled. A
 *    destination like `GLS Tower, Lobby 2` splits into two columns otherwise
 *    and every field after it on that row is shifted.
 *
 * 2. **Formula injection.** Excel and Sheets evaluate a cell whose first
 *    character is `=`, `+`, `-`, `@`, or a tab/carriage return — so a pickup
 *    point a requestor typed as `=HYPERLINK(...)` becomes a live formula in a
 *    file an admin opens. This is a real path from free-text user input to code
 *    execution on someone else's machine, and CSV quoting does nothing about
 *    it: the guard is a leading apostrophe, which spreadsheets strip on display
 *    and never evaluate.
 */
export function escapeCsvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

/** Rows of already-stringified cells → one CSV document, CRLF per RFC 4180. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

/** The export's data rows, formatted the way the screen shows them. */
export function reservationCsv(rows: readonly ReservationRow[]): string {
  return toCsv([
    [...EXPORT_COLUMNS],
    ...rows.map((row) => [
      row.id,
      row.submittedAt,
      formatPlainDate(row.startDate) ?? row.startDate,
      formatPlainTime(row.startTime) ?? row.startTime,
      row.endTime === null
        ? EM_DASH
        : (formatPlainTime(row.endTime) ?? row.endTime),
      row.requestor,
      row.site,
      row.from,
      row.to,
      row.purpose,
      row.details,
      RIDE_MODE_LABELS[row.mode].title,
      row.driver ?? EM_DASH,
      row.vanLabel ?? EM_DASH,
      row.vanPlate ?? EM_DASH,
      row.status,
      row.updatedBy ?? EM_DASH,
      // Manila wall-clock, never the raw ISO instant: a spreadsheet opened in
      // another timezone would otherwise show a different day than the screen.
      lastUpdatedCell(row.updatedAt),
    ]),
  ]);
}

export interface ReportScope {
  site: SiteFilter;
  mode: ModeFilter;
  /** `"YYYY-MM"` or `ALL`. */
  month: string;
}

/**
 * `van-trips_manila_pickup_2026-08.csv`.
 *
 * Lower-case, no spaces, no punctuation beyond `_`, `-` and the extension: this
 * string becomes a filename on someone's disk, and the design's own template
 * (`s.reportVan + ' · ' + …`) would put a middle dot and a slash into one —
 * `Pickup/Drop Off` alone makes the name unwritable on every platform.
 */
export function reportFileName(scope: ReportScope): string {
  const parts = [
    "van-trips",
    scope.site === ALL ? "all-sites" : slug(scope.site),
    scope.mode === ALL ? "all-types" : scope.mode,
    scope.month === ALL ? "all-time" : scope.month,
  ];
  return `${parts.join("_")}.csv`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `updatedAt` as the screen shows it, or an em dash while nothing has happened. */
function lastUpdatedCell(updatedAt: string | null): string {
  if (updatedAt === null) return EM_DASH;
  const instant = new Date(updatedAt);
  return formatInstant(instant) ?? EM_DASH;
}
