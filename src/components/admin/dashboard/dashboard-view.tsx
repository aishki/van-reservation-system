"use client";

import { useState } from "react";
import {
  ADMIN_CARD,
  ADMIN_PAGE,
  ADMIN_SECTION_HEADING,
  FOCUS_RING,
  SEGMENT_BASE,
  SEGMENT_GROUP,
  SEGMENT_OFF,
  SEGMENT_ON,
} from "@/components/admin/admin-theme";
import { QuarterSelect } from "@/components/admin/dashboard/quarter-select";
import { StatusDonut } from "@/components/admin/dashboard/status-donut";
import { TripsByTypeChart } from "@/components/admin/dashboard/trips-by-type-chart";
import { TripsTrendChart } from "@/components/admin/dashboard/trips-trend-chart";
import { formatPlainMonth } from "@/lib/tz";
import { cn } from "@/lib/utils";
import {
  ALL,
  filterByMonth,
  filterByQuarter,
  monthsOfQuarter,
  quartersIn,
  type SiteFilter,
  share,
  statusBreakdown,
} from "@/modules/reservations/admin-filters";
import {
  monthlyStatusTrend,
  SLA_THRESHOLD_HOURS,
  slaSummary,
  tripsByType,
} from "@/modules/reservations/dashboard-metrics";
import {
  APPROVED_STATUSES,
  type ReservationRow,
  SITE_LOCATIONS,
} from "@/modules/reservations/types";

const SITE_OPTIONS: SiteFilter[] = [...SITE_LOCATIONS, ALL];

// Minimal stroke icons for the summary tiles — inline so the tiles carry no
// dependency on a specific icon-set version.
const ICON = {
  clipboard:
    "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h4",
  check: "M20 6 9 17l-5-5",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  gauge: "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm1.5-1.5L18 8M4 20a9 9 0 1 1 16 0",
} as const;

function Icon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * The admin analytics dashboard: live counts, turnaround/SLA, and shadcn charts,
 * all recomputed against the site and month filters.
 *
 * TAT and SLA follow the product definition, not the SRS: turnaround is the gap
 * from submission to the FIRST driver assignment (first counts even if the
 * driver is reassigned), and a trip is within SLA at ≤ 12h. See
 * `dashboard-metrics.ts`. The quarter and month filters narrow every panel
 * except the trend, which needs every month to read as a trend.
 */
export function DashboardView({ rows }: { rows: ReservationRow[] }) {
  const [site, setSite] = useState<SiteFilter>(ALL);
  const [quarter, setQuarter] = useState<string | null>(null);
  const [month, setMonth] = useState<string>(ALL);

  const bySite = site === ALL ? rows : rows.filter((row) => row.site === site);
  const quarters = quartersIn(bySite);
  // A quarter that had rows under the previous site may not exist under this
  // one; fall back to All Time rather than filtering on an empty quarter.
  const activeQuarter = quarters.some((option) => option.value === quarter)
    ? quarter
    : null;
  // With no quarter chosen the segment still offers a trio — the latest
  // quarter's — so a month is always one click away (mirrors the design's
  // unselected-dropdown-with-active-month state).
  const segmentQuarter = activeQuarter ?? quarters[0]?.value ?? null;
  const quarterMonths =
    segmentQuarter === null ? [] : monthsOfQuarter(segmentQuarter);
  const activeMonth = quarterMonths.some((option) => option.value === month)
    ? month
    : ALL;
  const visible =
    activeMonth !== ALL
      ? filterByMonth(bySite, activeMonth)
      : activeQuarter !== null
        ? filterByQuarter(bySite, activeQuarter)
        : [...bySite];

  const selectQuarter = (next: string | null) => {
    setQuarter(next);
    setMonth(ALL);
  };
  const selectAllTime = () => {
    setQuarter(null);
    setMonth(ALL);
  };
  const allTimeActive = activeQuarter === null && activeMonth === ALL;

  const { counts, total } = statusBreakdown(visible);
  // Both spellings. The donut shows them apart because they ARE different
  // states; the headline answers "how many were approved", which is one number.
  const approvedTotal = [...APPROVED_STATUSES].reduce(
    (sum, status) => sum + counts[status],
    0,
  );
  const byType = tripsByType(visible);
  const sla = slaSummary(visible);
  const trend = monthlyStatusTrend(bySite);

  return (
    <div className={ADMIN_PAGE}>
      <div className="flex flex-col gap-8">
        <div
          className={cn(
            ADMIN_CARD,
            "flex flex-wrap items-center gap-4 px-5 py-4 md:px-7",
          )}
        >
          <div className="flex flex-wrap items-center gap-4">
            <QuarterSelect
              quarters={quarters}
              value={activeQuarter}
              onChange={selectQuarter}
            />
            <div className={SEGMENT_GROUP}>
              {quarterMonths.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={activeMonth === option.value}
                  onClick={() => setMonth(option.value)}
                  className={cn(
                    SEGMENT_BASE,
                    activeMonth === option.value ? SEGMENT_ON : SEGMENT_OFF,
                  )}
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={allTimeActive}
                onClick={selectAllTime}
                className={cn(
                  SEGMENT_BASE,
                  allTimeActive ? SEGMENT_ON : SEGMENT_OFF,
                )}
              >
                All Time
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 md:ml-auto">
            {SITE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={site === option}
                onClick={() => setSite(option)}
                className={cn(
                  "cursor-pointer rounded-pill border-0 px-6 py-3 text-body whitespace-nowrap transition-[filter] hover:brightness-[0.97]",
                  FOCUS_RING,
                  site === option
                    ? "bg-brand font-semibold text-primary-foreground"
                    : "bg-gray-5 font-normal text-gray-2",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <section aria-labelledby="exec-heading">
          <h2 id="exec-heading" className={cn(ADMIN_SECTION_HEADING, "mb-4")}>
            Executive Summary
          </h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              accent
              icon={ICON.clipboard}
              label="Total requests"
              value={total}
              foot={scopeLabel(
                site,
                quarters.find((option) => option.value === activeQuarter)
                  ?.label ?? null,
                activeMonth,
              )}
            />
            <Kpi
              icon={ICON.check}
              label="Approved"
              value={approvedTotal}
              foot={`${share(approvedTotal, total)} of all requests`}
            />
            <Kpi
              icon={ICON.clock}
              label="Avg TAT"
              value={formatHours(sla.avgTatHours)}
              foot="submission → first assignment"
            />
            <Kpi
              icon={ICON.gauge}
              label="SLA %"
              value={formatPercent(sla.slaPct)}
              foot={`within ${SLA_THRESHOLD_HOURS}h turnaround`}
            />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className={cn(ADMIN_CARD, "border border-gray-6 px-6 py-6")}>
            <h3 className="mb-5 text-lg font-semibold text-gray-1">
              Trips Breakdown by Status
            </h3>
            <StatusDonut counts={counts} total={total} />
          </div>
          <div className={cn(ADMIN_CARD, "border border-gray-6 px-6 py-6")}>
            <h3 className="mb-4 text-lg font-semibold text-gray-1">
              Trips Trend
            </h3>
            <TripsTrendChart data={trend} />
          </div>
        </section>

        <section aria-labelledby="sla-heading">
          <h2 id="sla-heading" className={cn(ADMIN_SECTION_HEADING, "mb-1")}>
            SLA
          </h2>
          <p className="mb-4 max-w-[80ch] text-sm text-pretty text-gray-2">
            Turnaround is submission to the first driver assignment; a trip is
            within SLA at {SLA_THRESHOLD_HOURS} hours or less. The first
            assignment is the basis even if the driver is later reassigned.
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <SlaCard
              label="SLA compliance"
              value={formatPercent(sla.slaPct)}
              foot={`${sla.withinSla} of ${sla.assigned} assigned within ${SLA_THRESHOLD_HOURS}h`}
            />
            <SlaCard
              label="Within SLA"
              value={String(sla.withinSla)}
              foot={`of ${sla.assigned} assigned trips`}
            />
            <SlaCard
              label="Breached"
              value={String(sla.assigned - sla.withinSla)}
              foot={`over ${SLA_THRESHOLD_HOURS}h turnaround`}
            />
          </div>
        </section>

        <section aria-labelledby="type-heading">
          <h2 id="type-heading" className={cn(ADMIN_SECTION_HEADING, "mb-4")}>
            Trips by Type
          </h2>
          <div className={cn(ADMIN_CARD, "border border-gray-6 px-6 py-6")}>
            <TripsByTypeChart data={byType} />
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  foot,
  accent = false,
}: {
  icon: string;
  label: string;
  value: string | number;
  foot: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        ADMIN_CARD,
        "flex flex-col justify-center gap-4 px-6 py-6",
        accent ? "border border-brand bg-brand" : "border border-gray-6",
      )}
    >
      <div className="flex items-center gap-4">
        <span
          className={cn(
            "flex size-12 flex-none items-center justify-center rounded-field",
            accent
              ? "bg-white/15 text-primary-foreground"
              : "bg-brand-tint text-brand",
          )}
        >
          <Icon path={icon} />
        </span>
        <span
          className={cn(
            "text-lg font-semibold",
            accent ? "text-primary-foreground" : "text-gray-1",
          )}
        >
          {label}
        </span>
      </div>
      <span
        className={cn(
          "text-[2.5rem] leading-none font-bold tabular-nums",
          accent ? "text-primary-foreground" : "text-gray-1",
        )}
      >
        {value}
      </span>
      <span
        className={cn(
          "text-xs",
          accent ? "text-primary-foreground/75" : "text-gray-2",
        )}
      >
        {foot}
      </span>
    </div>
  );
}

function SlaCard({
  label,
  value,
  foot,
}: {
  label: string;
  value: string;
  foot: string;
}) {
  return (
    <div className={cn(ADMIN_CARD, "border border-gray-6 px-6 py-6")}>
      <span className="text-base font-semibold text-brand">{label}</span>
      <p className="mt-3 text-[2.25rem] leading-none font-bold text-gray-1 tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-xs text-gray-2">{foot}</p>
    </div>
  );
}

/** `4.2h`, or `—` when nothing is assigned. */
function formatHours(hours: number | null): string {
  return hours === null ? "—" : `${Math.round(hours * 10) / 10}h`;
}

/** `92%`, or `—` when nothing is assigned. */
function formatPercent(pct: number | null): string {
  return pct === null ? "—" : `${Math.round(pct)}%`;
}

/** "Manila · Mar 2026", "All sites · Q1 2026", "All sites · All Time". */
function scopeLabel(
  site: SiteFilter,
  quarterLabel: string | null,
  month: string,
): string {
  const sitePart = site === ALL ? "All sites" : site;
  const monthPart =
    month !== ALL
      ? (formatPlainMonth(month) ?? month)
      : (quarterLabel ?? "All Time");
  return `${sitePart} · ${monthPart}`;
}
