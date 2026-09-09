import {
  ALL,
  type ModeFilter,
  type SiteFilter,
} from "@/modules/reservations/admin-filters";

/**
 * The admin report's scope (FR-16) — site, van type, and month, the three
 * filters `ReportForm` offers. Shared between the form's live preview and
 * `/api/reports/export`, which re-applies it server-side; see
 * `filterReportScope` in `admin-filters.ts`.
 */
export interface ReportScope {
  site: SiteFilter;
  mode: ModeFilter;
  /** `"YYYY-MM"` or `ALL`. */
  month: string;
}

/**
 * `van-trips_manila_pickup_2026-08.xlsx`.
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
  return `${parts.join("_")}.xlsx`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
