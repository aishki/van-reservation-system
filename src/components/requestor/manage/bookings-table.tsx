"use client";

import { CalendarX2 } from "lucide-react";
import Link from "next/link";
import { RowMenu } from "@/components/common/row-menu";
import { StatusChip } from "@/components/common/status-chip";
import { EM_DASH, formatInstant, formatPlainDate } from "@/lib/tz";
import {
  isCancellable,
  isRequestorEditable,
  type ReservationRow,
  RIDE_MODE_LABELS,
} from "@/modules/reservations/types";

interface BookingsTableProps {
  rows: ReservationRow[];
  onCancel: (row: ReservationRow) => void;
  onDownload: (row: ReservationRow) => void;
}

/** Header labels, in the design's order. The last column holds the row menu. */
const COLUMNS = [
  "Date Submitted",
  "Pickup Date/Start Date",
  "Requestor",
  "Location",
  "From",
  "To",
  "Van Type",
  "Status",
  "Updated by",
] as const;

/**
 * The requests table.
 *
 * `Date Submitted` is an instant and goes through `formatInstant`; the start date
 * is a plain calendar date and goes through `formatPlainDate`. Routing the second
 * one through a timezone is exactly how a booking displays the day before the one
 * that was requested — see `lib/tz.ts`.
 *
 * The final column's header is an empty string in the design. Here it carries a
 * visually-hidden "Actions" label instead: an empty `th` leaves a screen reader
 * announcing the menu button with no column context at all.
 *
 * `min-w-[980px]` inside an `overflow-x-auto` wrapper: ten columns cannot fit a
 * narrow viewport, and letting the table shrink instead produces four-character
 * columns. The wrapper is focusable so the scroll region is reachable by keyboard.
 *
 * That wrapper also gets a `min-h`. `overflow-x: auto` establishes a clipping
 * context on BOTH axes, so the row menu — absolutely positioned inside it — was
 * cut off whenever the table was shorter than the open menu: with one or two
 * bookings, the actions were invisible. The minimum height reserves room for the
 * menu to open into.
 */
export function BookingsTable({
  rows,
  onCancel,
  onDownload,
}: BookingsTableProps) {
  return (
    // A `section` with an accessible name is already a `region`, so no explicit
    // role is needed. It is focusable because a scroll container that is not
    // reachable by keyboard hides the columns that overflow from anyone not using
    // a pointer — WCAG 2.1.1. Biome's rule models "non-interactive elements must
    // not be focusable" and has no exception for scroll containers, which is the
    // one case where the opposite is required.
    <section
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-reachable scroll container, required by WCAG 2.1.1
      tabIndex={0}
      aria-label="Bookings, scrollable horizontally"
      className="max-w-full min-h-[320px] min-w-0 overflow-x-auto focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <table className="w-full min-w-[980px] border-collapse tabular-nums">
        <thead>
          <tr>
            {COLUMNS.map((label) => (
              <th
                key={label}
                scope="col"
                className="border-b border-gray-4 px-4 py-3.5 text-left text-body font-semibold whitespace-nowrap text-gray-1"
              >
                {label}
              </th>
            ))}
            <th
              scope="col"
              className="border-b border-gray-4 px-4 py-3.5 text-right"
            >
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const editable = isRequestorEditable(row.status);
            const cancellable = isCancellable(row.status);
            return (
              <tr key={row.id} className="border-b border-gray-6">
                <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                  {formatInstant(new Date(row.submittedAt)) ?? EM_DASH}
                </td>
                <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                  {formatPlainDate(row.startDate) ?? EM_DASH}
                </td>
                <th
                  scope="row"
                  className="px-4 py-4 text-left text-body font-normal whitespace-nowrap text-gray-1"
                >
                  {row.requestor}
                </th>
                <td className="px-4 py-4 text-body text-gray-1">{row.site}</td>
                <td className="px-4 py-4 text-body text-gray-1">{row.from}</td>
                <td className="px-4 py-4 text-body text-gray-1">{row.to}</td>
                <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                  {RIDE_MODE_LABELS[row.mode].title}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <StatusChip status={row.status} />
                </td>
                <td className="px-4 py-4 text-body whitespace-nowrap text-gray-2">
                  {row.updatedBy ?? EM_DASH}
                </td>
                <td className="px-4 py-4">
                  <RowMenu
                    reference={row.id}
                    actions={[
                      {
                        label: "Edit request",
                        enabled: editable,
                        disabledReason: "Only pending bookings can be changed.",
                        // Editing re-enters the wizard in the booking's own mode.
                        // A full edit flow needs the saved draft loaded back in,
                        // which needs the API — until then this starts a fresh
                        // request of the right kind rather than pretending to
                        // load one.
                        onSelect: () => {
                          window.location.href = `/book?mode=${row.mode}`;
                        },
                      },
                      {
                        label: "Cancel booking",
                        enabled: cancellable,
                        disabledReason:
                          "Rejected and cancelled bookings can't be cancelled.",
                        onSelect: () => onCancel(row),
                      },
                      {
                        label: "Download summary",
                        enabled: true,
                        onSelect: () => onDownload(row),
                      },
                    ]}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

interface EmptyStateProps {
  title: string;
  body: string;
}

/**
 * Shown when a filter matches nothing.
 *
 * The design places a bespoke illustration here (`public/figma/empty-trips.svg`),
 * which is not among the delivered assets — so the slot is a marked placeholder
 * rather than a substituted drawing. The copy carries the message on its own.
 */
export function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-[70px] text-center">
      {/* SEAM — drop `empty-trips.svg` into public/assets/ and replace this
          with an <Image>. It is decorative: keep it aria-hidden with alt="". */}
      <span
        aria-hidden="true"
        className="mb-6 flex size-16 items-center justify-center rounded-pill bg-brand-tint text-brand"
      >
        <CalendarX2 className="size-7" />
      </span>
      <h3 className="mb-2 text-[1.375rem] font-semibold text-plum">{title}</h3>
      <p className="mb-6 max-w-[420px] text-body text-pretty text-gray-2">
        {body}
      </p>
      <Link
        href="/?view=choose"
        className="rounded-pill bg-brand px-[34px] py-[15px] text-body font-semibold text-primary-foreground transition-[filter] hover:brightness-110"
      >
        Book a trip
      </Link>
    </div>
  );
}
