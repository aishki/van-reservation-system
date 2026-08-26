"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ADMIN_CARD,
  ADMIN_PAGE,
  FOCUS_RING,
} from "@/components/admin/admin-theme";
import { useTripDrawer } from "@/components/admin/trip-drawer/trip-drawer-host";
import { Hint } from "@/components/common/hint";
import { StatusChip } from "@/components/common/status-chip";
import {
  addPlainDays,
  EM_DASH,
  formatPlainDate,
  formatPlainTime,
  startOfWeek,
} from "@/lib/tz";
import { cn } from "@/lib/utils";
import {
  buildCalendarWeek,
  type CalendarEvent,
  gutterHours,
  SLOT_HEIGHT_PX,
  SLOT_MINUTES,
} from "@/modules/reservations/calendar";
import {
  type ReservationRow,
  RIDE_MODE_LABELS,
  type SiteLocation,
} from "@/modules/reservations/types";

interface CalendarViewProps {
  rows: ReservationRow[];
  /** Manila's today, computed on the server — see `todayInManila`. */
  today: string;
  /** The signed-in admin, for the drawer this view now opens. */
  adminName: string;
}

const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

/** Pixels per minute, so an event's top and height follow its real time. */
const PX_PER_MINUTE = SLOT_HEIGHT_PX / SLOT_MINUTES;

/**
 * Colour by site. Both pairings carry their text at AA on their own tint.
 *
 * The design hard-codes Iloilo purple and Manila green in three places; here it
 * is one record keyed by the domain's own site list, so adding a third site is
 * a single line rather than a hunt.
 */
const SITE_TONE: Record<
  SiteLocation,
  { block: string; ink: string; edge: string }
> = {
  Iloilo: {
    block: "bg-site-iloilo-tint",
    ink: "text-site-iloilo-ink",
    edge: "border-l-site-iloilo-ink",
  },
  Manila: {
    block: "bg-site-manila-tint",
    ink: "text-site-manila-ink",
    edge: "border-l-site-manila-ink",
  },
};

/**
 * The weekly schedule.
 *
 * Events are absolutely positioned inside each day column by wall-clock minute,
 * not snapped into CSS grid rows. The design's grid assumes every trip starts
 * on a 30-minute boundary; a 06:45 pickup has nowhere to go in that model and
 * would be drawn at 06:30 or 07:00 — a quarter hour of error on the view an
 * admin uses to spot collisions. Positioning by minute costs nothing and is
 * exact.
 *
 * Overlapping trips share a day column side by side rather than stacking. See
 * `assignLanes`.
 */
export function CalendarView({ rows, today, adminName }: CalendarViewProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today) ?? today);

  // The Master List's drawer, not a second copy: approve, reject, edit and
  // reassign all work from here with no further code.
  const { openFor, drawer } = useTripDrawer({
    adminName,
    onDecided: (result) =>
      toast.success(`${result.id} ${result.status.toLowerCase()}.`),
  });

  const week = buildCalendarWeek(rows, weekStart);
  const { windowStart, windowEnd } = week;
  const height = (windowEnd - windowStart) * PX_PER_MINUTE;
  const hours = gutterHours(windowStart, windowEnd);

  const shiftWeek = (days: number) =>
    setWeekStart((current) => addPlainDays(current, days) ?? current);

  const first = week.days[0].date;
  const last = week.days[6].date;

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
            <button
              type="button"
              onClick={() => setWeekStart(startOfWeek(today) ?? today)}
              className={cn(
                "cursor-pointer rounded-pill border border-gray-4 bg-background px-4 py-2 text-sm text-gray-1 hover:border-primary",
                FOCUS_RING,
              )}
            >
              This week
            </button>
          </div>

          {/* aria-live so a screen reader hears the new range after pressing
              Previous or Next — otherwise the buttons appear to do nothing. */}
          <h2 aria-live="polite" className="text-xl font-semibold text-gray-1">
            {formatPlainDate(first) ?? first} – {formatPlainDate(last) ?? last}
          </h2>

          <div className="flex flex-wrap items-center gap-4 md:ml-auto">
            {(Object.keys(SITE_TONE) as SiteLocation[]).map((site) => (
              <span
                key={site}
                className="flex items-center gap-2 text-sm text-gray-2"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-3 rounded-[3px] border border-current",
                    SITE_TONE[site].block,
                    SITE_TONE[site].ink,
                  )}
                />
                {site}
              </span>
            ))}
            <span className="flex items-center gap-2 text-sm text-gray-2">
              <span className="rounded-pill bg-brand-tint px-1.5 py-0.5 text-[0.6875rem] font-bold text-brand">
                PENDING
              </span>
              driver or van not assigned
            </span>
            <span className="flex items-center gap-2 text-sm text-gray-2">
              <span className="rounded-pill bg-gray-5 px-1.5 py-0.5 text-[0.6875rem] font-bold text-gray-1">
                RENTAL
              </span>
              driver or van is a rental
            </span>
            <span className="flex items-center gap-2 text-sm text-gray-2">
              <span className="rounded-pill bg-gray-5 px-1.5 py-0.5 text-[0.6875rem] font-bold text-gray-1">
                3 TRIPS
              </span>
              three or more overlap — click to pick one
            </span>
          </div>
        </div>

        <section
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-reachable scroll container, required by WCAG 2.1.1
          tabIndex={0}
          aria-label="Weekly schedule, scrollable horizontally"
          className="max-w-full min-w-0 overflow-x-auto focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        >
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-gray-4">
              <span />
              {week.days.map((day, index) => (
                <div key={day.date} className="px-2 py-2.5 text-center">
                  <p className="text-xs tracking-[0.08em] text-gray-2">
                    {DAY_NAMES[index]}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-lg font-semibold",
                      day.date === today ? "text-brand" : "text-gray-1",
                    )}
                  >
                    {day.date.slice(8)}
                    {day.date === today && (
                      <span className="sr-only"> (today)</span>
                    )}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))]">
              <div
                className="relative border-r border-gray-6"
                style={{ height }}
              >
                {hours.map((minute) => (
                  <span
                    key={minute}
                    className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-gray-3"
                    style={{ top: (minute - windowStart) * PX_PER_MINUTE }}
                  >
                    {formatPlainTime(
                      `${String(Math.floor(minute / 60)).padStart(2, "0")}:00`,
                    ) ?? EM_DASH}
                  </span>
                ))}
              </div>

              {week.days.map((day) => (
                <div
                  key={day.date}
                  className="relative border-r border-gray-6 last:border-r-0"
                  style={{
                    height,
                    // One hairline every half hour, the darker one on the hour.
                    backgroundImage: `repeating-linear-gradient(to bottom, var(--color-gray-6) 0 1px, transparent 1px ${SLOT_HEIGHT_PX * 2}px), repeating-linear-gradient(to bottom, var(--color-gray-5) 0 1px, transparent 1px ${SLOT_HEIGHT_PX}px)`,
                  }}
                >
                  {day.clusters.map((cluster) =>
                    // One or two fit side by side and stay readable; collapsing
                    // them would hide information that currently fits.
                    cluster.length < STACK_THRESHOLD ? (
                      cluster.map((event) => (
                        <EventBlock
                          key={event.row.id}
                          event={event}
                          windowStart={windowStart}
                          onOpen={openFor}
                        />
                      ))
                    ) : (
                      <StackBlock
                        key={`${day.date}-${cluster[0].cluster}`}
                        cluster={cluster}
                        windowStart={windowStart}
                        onOpen={openFor}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {week.unplaced.length > 0 && (
          <p className="mt-4 rounded-field border border-error-tint-border bg-error-tint px-4 py-3 text-sm text-error">
            {week.unplaced.length} request
            {week.unplaced.length === 1 ? "" : "s"} could not be placed —{" "}
            {week.unplaced.map((r) => r.id).join(", ")}. Their times are
            malformed.
          </p>
        )}
      </div>
      {drawer}
    </div>
  );
}

/** Three is where side-by-side blocks stop being readable. */
const STACK_THRESHOLD = 3;

/**
 * Three or more trips contesting one span, drawn as a single block.
 *
 * Spans `min(startMinute)` to `max(endMinute)` of its members, which may exceed
 * any one trip's own block — that is correct: what it represents is the whole
 * contested span, not any particular trip.
 *
 * Tinted neutral rather than by site: a cluster can hold trips from both sites,
 * and either site colour would be a claim about the group that is not true.
 */
function StackBlock({
  cluster,
  windowStart,
  onOpen,
}: {
  cluster: CalendarEvent[];
  windowStart: number;
  onOpen: (reference: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const start = Math.min(...cluster.map((event) => event.startMinute));
  const end = Math.max(...cluster.map((event) => event.endMinute));
  const top = (start - windowStart) * PX_PER_MINUTE;
  const height = (end - start) * PX_PER_MINUTE;

  // Attached to the BUTTONS, not to a wrapping div: a static element with a
  // key handler is unreachable by keyboard, and these are the only things in
  // this block a keyboard user can be focused on.
  const closeOnEscape = (keyEvent: React.KeyboardEvent) => {
    if (keyEvent.key === "Escape" && expanded) {
      keyEvent.stopPropagation();
      setExpanded(false);
    }
  };

  return (
    <div
      className="absolute z-10"
      style={{
        top,
        height: Math.max(height, SLOT_HEIGHT_PX * 0.6),
        left: 2,
        right: 2,
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        onKeyDown={closeOnEscape}
        className={cn(
          "size-full cursor-pointer rounded-md border-0 border-l-[3px] border-l-gray-3 bg-gray-5 px-2 py-1 text-left text-gray-1",
          FOCUS_RING,
        )}
      >
        <span className="text-xs leading-tight font-semibold">
          {cluster.length} trips on this block
        </span>
      </button>

      {expanded && (
        <ul className="absolute top-full left-0 z-20 mt-1 flex w-[240px] flex-col gap-1 rounded-card border border-gray-4 bg-background p-2 shadow-lg">
          {cluster.map((event) => (
            <li key={event.row.id}>
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  onOpen(event.row.id);
                }}
                onKeyDown={closeOnEscape}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-1 rounded-field border-0 bg-transparent px-2 py-1.5 text-left hover:bg-gray-6",
                  FOCUS_RING,
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-1">
                  {event.row.id}
                  <StatusChip status={event.row.status} />
                </span>
                <span className="text-xs text-gray-2">
                  {formatPlainTime(event.row.startTime) ?? EM_DASH} ·{" "}
                  {event.row.requestor}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventBlock({
  event,
  windowStart,
  onOpen,
}: {
  event: CalendarEvent;
  windowStart: number;
  onOpen: (reference: string) => void;
}) {
  const { row } = event;
  const tone = SITE_TONE[row.site];
  const top = (event.startMinute - windowStart) * PX_PER_MINUTE;
  const height = (event.endMinute - event.startMinute) * PX_PER_MINUTE;
  const width = 100 / event.lanes;

  const timeLabel =
    row.endTime === null
      ? (formatPlainTime(row.startTime) ?? EM_DASH)
      : `${formatPlainTime(row.startTime) ?? EM_DASH} – ${formatPlainTime(row.endTime) ?? EM_DASH}`;

  return (
    <Hint content={<BlockPreview row={row} timeLabel={timeLabel} />}>
      <button
        type="button"
        onClick={() => onOpen(row.id)}
        // The block is too small to hold the whole trip, so the name carries what
        // the eye cannot read at this size.
        aria-label={`Trip ${row.id}, ${row.requestor}, ${timeLabel}, ${row.site}`}
        className={cn(
          // The button's own chrome is reset first, so this looks identical to
          // the div it replaced.
          "absolute cursor-pointer overflow-hidden rounded-md border-0 border-l-[3px] p-0 px-2 py-1 text-left",
          FOCUS_RING,
          tone.block,
          tone.ink,
          tone.edge,
        )}
        style={{
          top,
          height: Math.max(height, SLOT_HEIGHT_PX * 0.6),
          left: `calc(${event.lane * width}% + 2px)`,
          width: `calc(${width}% - 4px)`,
        }}
      >
        <p className="flex items-center gap-1.5 text-[0.6875rem] leading-tight font-bold whitespace-nowrap">
          {timeLabel}
          {event.crossesMidnight && (
            <span className="font-normal text-gray-2">→ next day</span>
          )}
          {event.isRental && (
            <span className="ml-auto flex-none rounded-pill bg-gray-1 px-1.5 py-px text-[0.5625rem] leading-snug font-bold tracking-[0.04em] text-background">
              RENTAL
            </span>
          )}
          {event.awaitingAssignment && (
            <span className="ml-auto flex-none rounded-pill bg-background px-1.5 py-px text-[0.5625rem] leading-snug font-bold tracking-[0.04em]">
              PENDING
            </span>
          )}
        </p>
        <p className="truncate text-xs leading-tight font-semibold text-gray-1">
          {row.from} → {row.to} · {row.requestor}
        </p>
        <p className="truncate text-[0.6875rem] leading-tight text-gray-2">
          {RIDE_MODE_LABELS[row.mode].compact} · {row.id}
        </p>
      </button>
    </Hint>
  );
}

/**
 * The whole trip, for the hover and focus preview.
 *
 * The blocks are sized by duration, so a 30-minute trip has room for about
 * three words. This is where the trip is actually readable without opening it.
 */
function BlockPreview({
  row,
  timeLabel,
}: {
  row: ReservationRow;
  timeLabel: string;
}) {
  return (
    <div className="flex max-w-[280px] flex-col gap-1.5 text-left">
      <p className="flex items-center gap-2 font-semibold">
        {row.id}
        <StatusChip status={row.status} />
      </p>
      <p>
        {row.requestor} · {row.site}
      </p>
      <p>{timeLabel}</p>
      <p>
        {row.from} → {row.to}
      </p>
      <p className="text-pretty">{row.purpose}</p>
      <p>
        Driver: {row.driver ?? "Not assigned"}
        {row.driverSource === "rental" && " (rental)"}
      </p>
      <p>
        Van: {row.vanLabel ?? "Not assigned"}
        {row.vanPlate !== null && ` · ${row.vanPlate}`}
        {row.vanSource === "rental" && " (rental)"}
      </p>
    </div>
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
