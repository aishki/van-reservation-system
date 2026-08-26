"use client";

import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ADMIN_CARD,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  PILL_BASE,
  PILL_OFF,
  PILL_ON,
} from "@/components/admin/admin-theme";
import { cn } from "@/lib/utils";
import {
  ALL,
  filterByMonth,
  type ModeFilter,
  monthsIn,
  type SiteFilter,
} from "@/modules/reservations/admin-filters";
import { reportFileName, reservationCsv } from "@/modules/reservations/export";
import {
  type ReservationRow,
  RIDE_MODE_LABELS,
  RIDE_MODES,
  SITE_LOCATIONS,
} from "@/modules/reservations/types";

const SITE_OPTIONS: SiteFilter[] = [ALL, ...SITE_LOCATIONS];
const MODE_OPTIONS: ModeFilter[] = [ALL, ...RIDE_MODES];

interface ReportScope {
  site: SiteFilter;
  mode: ModeFilter;
  month: string;
}

const BLANK: ReportScope = { site: ALL, mode: ALL, month: ALL };

/**
 * Report generation (FR-16).
 *
 * Two departures from the design worth naming:
 *
 * - **The row count is real.** The design's preview card reads "237 rows"
 *   regardless of what is selected. Here the count is the number of rows the
 *   current scope actually matches, so an admin finds out that a combination is
 *   empty before downloading an empty file rather than after.
 * - **Download produces a file.** The design's button raises a toast saying the
 *   export runs through the API. A button that looks operable and does nothing
 *   reads as broken, and the data needed for the export is already on this
 *   page — so it writes a real CSV client-side. The `.xlsx` the design names
 *   comes from the server endpoint, which owns the formatting and the audit
 *   record; this is the same rows, in the format a browser can produce alone.
 *
 * The date range is a month picker derived from the data, not the design's
 * fixed quarter-plus-three-months control — see `monthsIn`.
 */
export function ReportForm({ rows }: { rows: ReservationRow[] }) {
  const [scope, setScope] = useState<ReportScope>(BLANK);
  const [generated, setGenerated] = useState<ReportScope | null>(null);

  const months = monthsIn(rows);
  const matching = matchRows(rows, scope);

  const set = (patch: Partial<ReportScope>) => {
    setScope((current) => ({ ...current, ...patch }));
    // The preview describes the scope that produced it. Leaving it on screen
    // after a filter changes would offer a download of the previous selection
    // under the new selection's labels.
    setGenerated(null);
  };

  const download = () => {
    if (generated === null) return;
    const csv = reservationCsv(matchRows(rows, generated));
    /**
     * SEAM — replace with `GET /api/reports/export`, which owns the .xlsx
     * formatting and writes the audit record. That handler re-applies the scope
     * server-side: these three filters decide which rows leave the building, so
     * trusting the client's selection would let a crafted request export
     * anything.
     */
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = reportFileName(generated);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex justify-center px-4 py-8 md:px-10 md:py-12">
      <div
        className={cn(
          ADMIN_CARD,
          "w-full max-w-[980px] px-6 py-9 shadow-[0_18px_50px_color-mix(in_srgb,var(--color-navy)_6%,transparent)] md:px-14 md:py-11",
        )}
      >
        <h2 className="mb-8 text-h3 font-medium text-gray-1">
          Generate Report
        </h2>

        <div className="flex flex-col gap-7">
          <OptionGroup
            legend="Location"
            options={SITE_OPTIONS}
            selected={scope.site}
            labelFor={(option) => (option === ALL ? "All sites" : option)}
            onSelect={(site) => set({ site })}
          />
          <OptionGroup
            legend="Van Type"
            options={MODE_OPTIONS}
            selected={scope.mode}
            labelFor={(option) =>
              option === ALL ? "All types" : RIDE_MODE_LABELS[option].title
            }
            onSelect={(mode) => set({ mode })}
          />
          <OptionGroup
            legend="Date Range"
            options={months.map((month) => month.value)}
            selected={scope.month}
            labelFor={(option) =>
              months.find((month) => month.value === option)?.label ?? option
            }
            onSelect={(month) => set({ month })}
          />
        </div>

        {generated !== null && (
          <div className="mt-8 flex flex-wrap items-center gap-4 rounded-field border border-gray-4 bg-gray-5 px-5 py-4">
            <FileSpreadsheet
              aria-hidden="true"
              className="size-8 flex-none text-brand"
            />
            <div className="min-w-0">
              <p className="text-body font-semibold text-gray-1">
                {reportFileName(generated)}
              </p>
              <p className="mt-1 text-xs text-gray-2">
                {matching.length} row{matching.length === 1 ? "" : "s"}
                {matching.length === 0 && " — nothing matches this scope"}
              </p>
            </div>
            <button
              type="button"
              onClick={download}
              disabled={matching.length === 0}
              className={cn(
                "ml-auto cursor-pointer rounded-pill border-0 bg-brand px-6 py-3 text-[0.9375rem] font-semibold text-primary-foreground transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
                "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
              )}
            >
              Download .csv
            </button>
          </div>
        )}

        <div className="mt-10 flex flex-wrap justify-end gap-4">
          <button
            type="button"
            onClick={() => {
              setScope(BLANK);
              setGenerated(null);
            }}
            className={BUTTON_SECONDARY}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => {
              setGenerated(scope);
              if (matching.length === 0) {
                toast("Nothing matches this scope.", {
                  description: "Widen the site, van type or date range.",
                });
              }
            }}
            className={BUTTON_PRIMARY}
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}

function matchRows(
  rows: readonly ReservationRow[],
  scope: ReportScope,
): ReservationRow[] {
  return filterByMonth(rows, scope.month).filter((row) => {
    if (scope.site !== ALL && row.site !== scope.site) return false;
    if (scope.mode !== ALL && row.mode !== scope.mode) return false;
    return true;
  });
}

/**
 * One labelled group of mutually exclusive pills.
 *
 * A real `fieldset`/`legend` with `radio` inputs, not the design's
 * `aria-pressed` buttons. These ARE mutually exclusive choices in a form, which
 * is what a radio group means: arrow keys move between them, the group is
 * announced with its legend, and only one can be chosen by construction rather
 * than by the click handler remembering to clear the others.
 */
function OptionGroup<T extends string>({
  legend,
  options,
  selected,
  labelFor,
  onSelect,
}: {
  legend: string;
  options: readonly T[];
  selected: T;
  labelFor: (option: T) => string;
  onSelect: (option: T) => void;
}) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="mb-2.5 text-body font-medium text-gray-1">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-3.5">
        {options.map((option) => (
          <label
            key={option}
            className={cn(
              PILL_BASE,
              "min-w-[132px] text-center has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary",
              selected === option ? PILL_ON : PILL_OFF,
            )}
          >
            <input
              type="radio"
              name={legend}
              value={option}
              checked={selected === option}
              onChange={() => onSelect(option)}
              className="sr-only"
            />
            {labelFor(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
