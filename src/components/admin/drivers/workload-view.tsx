"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  ADMIN_CARD,
  ADMIN_PAGE,
  FOCUS_RING,
} from "@/components/admin/admin-theme";
import { RentalTag } from "@/components/common/rental-tag";
import { addPlainDays, EM_DASH, formatPlainDate, startOfWeek } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { Driver } from "@/modules/drivers/types";
import { WEEKLY_HOURS_CAP } from "@/modules/drivers/types";
import {
  type DriverWorkload,
  type WorkloadSubject,
  weeklyWorkload,
} from "@/modules/drivers/workload";
import type { ReservationRow } from "@/modules/reservations/types";

interface WorkloadViewProps {
  drivers: Driver[];
  rows: ReservationRow[];
  /** Manila's today, computed on the server — see `todayInManila`. */
  today: string;
}

/**
 * Driver workload for one week (FR-14).
 *
 * DESIGN STATUS. The design document marks this screen as invented — it has no
 * Figma frame, unlike every other admin surface. The spec's scope table lists
 * it as in scope and cites FR-14, so it is built rather than left blank, but
 * the LAYOUT below is not a designer's: it is a table in the same idiom as the
 * master list. Worth a designer's eye before it is treated as final.
 *
 * Every number is derived from the reservations that name each driver. The
 * design's mock hard-codes a trip count, an hours string and a percentage per
 * driver, none of which are connected to the schedule — so reassigning a trip
 * would change nothing here, and the screen could only ever be decoration.
 */
export function WorkloadView({ drivers, rows, today }: WorkloadViewProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today) ?? today);

  const { workloads, unassignedTrips } = weeklyWorkload(
    drivers,
    rows,
    weekStart,
  );
  const weekEnd = addPlainDays(weekStart, 6) ?? weekStart;

  const shiftWeek = (days: number) =>
    setWeekStart((current) => addPlainDays(current, days) ?? current);

  return (
    <div className={ADMIN_PAGE}>
      <div className={cn(ADMIN_CARD, "px-5 py-6 md:px-7")}>
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <WeekButton label="Previous week" onClick={() => shiftWeek(-7)}>
              <ChevronLeft aria-hidden="true" className="size-4" />
            </WeekButton>
            <WeekButton label="Next week" onClick={() => shiftWeek(7)}>
              <ChevronRight aria-hidden="true" className="size-4" />
            </WeekButton>
          </div>
          <h2 aria-live="polite" className="text-xl font-semibold text-gray-1">
            {formatPlainDate(weekStart) ?? weekStart} –{" "}
            {formatPlainDate(weekEnd) ?? weekEnd}
          </h2>
          <p className="text-sm text-gray-2 md:ml-auto">
            Capacity {WEEKLY_HOURS_CAP}h per driver per week
          </p>
        </div>

        {unassignedTrips > 0 && (
          <p className="mb-5 rounded-field border border-brand-tint bg-brand-wash px-4 py-3 text-sm text-brand">
            {/* One expression, not three fragments around bare text. JSX drops
                the space before a newline that follows an expression, which is
                how the previous spelling rendered "1 trip hasno driver". */}
            {unassignedTrips === 1
              ? "1 trip has no driver assigned this week."
              : `${unassignedTrips} trips have no driver assigned this week.`}{" "}
            Assign one from the request&rsquo;s Trip Details.
          </p>
        )}

        <section
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-reachable scroll container, required by WCAG 2.1.1
          tabIndex={0}
          aria-label="Driver workload, scrollable horizontally"
          className="max-w-full min-w-0 overflow-x-auto focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        >
          <table className="w-full min-w-[900px] border-collapse tabular-nums">
            <thead>
              <tr>
                {[
                  "Driver",
                  "Vans this week",
                  "Site",
                  "Shift",
                  "Trips",
                  `Hours vs ${WEEKLY_HOURS_CAP}h cap`,
                ].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="border-b border-gray-4 px-4 py-3.5 text-left text-body font-semibold whitespace-nowrap text-gray-1"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workloads.map((entry) => (
                <WorkloadRow key={subjectKey(entry.subject)} entry={entry} />
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

/** A rental has no id, so the row key is derived from the subject itself. */
function subjectKey(subject: WorkloadSubject): string {
  return subject.kind === "roster"
    ? `roster:${subject.driver.id}`
    : `rental:${subject.name}`;
}

function WorkloadRow({ entry }: { entry: DriverWorkload }) {
  const { subject, trips, hours, load, over, vans } = entry;
  const isRoster = subject.kind === "roster";
  // Green below two thirds, purple approaching the cap, red past it. Colour is
  // never the only signal: the hours and the cap are both printed beside the
  // bar, and `over` is announced in the row's text — and a rental's missing
  // bar is called out by its own "Rental" tag, not left as the only tell.
  const tone =
    load === null
      ? null
      : over
        ? "bg-error"
        : load > 0.66
          ? "bg-brand"
          : "bg-success";

  return (
    <tr
      className={cn(
        "border-b border-gray-6",
        isRoster && !subject.driver.active && "opacity-60",
      )}
    >
      <th
        scope="row"
        className="px-4 py-4 text-left text-body font-normal whitespace-nowrap text-gray-1"
      >
        {isRoster ? subject.driver.name : subject.name}
        {isRoster && !subject.driver.active && (
          <span className="ml-2 rounded-pill bg-gray-5 px-2 py-0.5 text-xs font-semibold text-gray-2">
            Inactive
          </span>
        )}
        {!isRoster && (
          <span className="ml-2 inline-block align-middle">
            <RentalTag />
          </span>
        )}
      </th>
      <td className="px-4 py-4 text-body text-gray-1">
        {vans.length > 0 ? vans.join(", ") : EM_DASH}
      </td>
      <td className="px-4 py-4 text-body text-gray-1">
        {isRoster ? subject.driver.site : EM_DASH}
      </td>
      <td className="px-4 py-4 text-body text-gray-1">
        {isRoster ? (subject.driver.shift ?? EM_DASH) : EM_DASH}
      </td>
      <td className="px-4 py-4 text-body text-gray-1">{trips}</td>
      <td className="min-w-[240px] px-4 py-4">
        {load === null ? (
          <span className="text-sm font-semibold whitespace-nowrap text-gray-2">
            {hours}h
          </span>
        ) : (
          <div className="flex items-center gap-3">
            {/* Decorative. The hours and the cap are both printed — beside the
                bar and in the column header — so the bar carries nothing a screen
                reader would otherwise miss, and `role="meter"` here would be ARIA
                added for its own sake. Its width is capped at 100% while `load`
                is not, which is why the over-cap case needs the label to be the
                real value. */}
            <div
              aria-hidden="true"
              className="h-2.5 flex-1 overflow-hidden rounded-pill bg-gray-5"
            >
              <div
                className={cn("h-full rounded-pill", tone)}
                style={{ width: `${Math.min(load, 1) * 100}%` }}
              />
            </div>
            <span
              className={cn(
                "w-28 text-right text-sm font-semibold whitespace-nowrap",
                over ? "text-error" : "text-gray-2",
              )}
            >
              {hours}h of {WEEKLY_HOURS_CAP}
              {over && (
                <span className="block text-xs font-normal">over capacity</span>
              )}
            </span>
          </div>
        )}
      </td>
    </tr>
  );
}

function WeekButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-10 cursor-pointer items-center justify-center rounded-pill border border-gray-4 bg-background text-gray-1 hover:border-primary",
        FOCUS_RING,
      )}
    >
      {children}
    </button>
  );
}
