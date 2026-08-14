"use client";

import { ChevronDown, ChevronUp, SearchX } from "lucide-react";
import { FOCUS_RING } from "@/components/admin/admin-theme";
import { RentalTag } from "@/components/common/rental-tag";
import { RowMenu } from "@/components/common/row-menu";
import { StatusChip } from "@/components/common/status-chip";
import {
  EM_DASH,
  formatInstant,
  formatPlainDate,
  formatPlainTime,
} from "@/lib/tz";
import { cn } from "@/lib/utils";
import type {
  AdminSort,
  AdminTab,
  SortColumn,
} from "@/modules/reservations/admin-filters";
import {
  isReassignable,
  type ReservationRow,
  RIDE_MODE_LABELS,
} from "@/modules/reservations/types";

interface RequestTableProps {
  rows: ReservationRow[];
  /** Decides the last column: remarks while reviewing, actor once settled. */
  tab: AdminTab;
  /** Highlights the row whose drawer is open. */
  openId: string | null;
  onOpen: (row: ReservationRow) => void;
  onDecide: (row: ReservationRow, decision: "approve" | "reject") => void;
  onReassign: (row: ReservationRow) => void;
  sort: AdminSort;
  onSort: (column: SortColumn) => void;
}

/**
 * The admin requests table.
 *
 * `Date Submitted` is an instant and goes through `formatInstant`; the start
 * date and time are plain calendar values and go through `formatPlainDate` /
 * `formatPlainTime`. Routing the second pair through a timezone is exactly how a
 * booking displays the day before the one that was requested — see `lib/tz.ts`.
 *
 * The last column swaps between "Remarks" and "Updated by" with the tab,
 * which is right: while a request is pending there is no actor yet, and once
 * it is settled the remark is stale. It swaps the header too, so the column
 * is never mislabelled.
 *
 * "Van" and "Plate Number" are two different fields, not one relabelled:
 * `row.vanLabel` is the fleet's own numbering (e.g. "VAN-003"), which is what
 * most screens use to identify a van, while `row.vanPlate` is the plate on the
 * physical vehicle — what the client asked to see. Heading `vanLabel` "Plate
 * Number" would have mislabelled it for every roster row.
 *
 * The `Rental` tag sits on the Driver and Van cells, not Plate: `vanLabel`'s
 * plate fallback can make a rental van's entry look exactly like a fleet
 * number by shape (see `ReservationRow.vanSource`), which is the ambiguity the
 * tag exists to resolve. A real plate has no such ambiguity to clear up.
 *
 * `min-w-[1800px]` inside an `overflow-x-auto` wrapper: fifteen columns
 * cannot fit a narrow viewport, and letting the table shrink instead produces
 * four-character columns. The wrapper is focusable so the scroll region is
 * reachable by keyboard.
 *
 * The Details cell is clamped to two lines (`line-clamp-2`, capped at
 * `max-w-[280px]`): it is a requestor-written paragraph, and left unclamped it
 * would set every row's height by whichever entry rambled the longest.
 */
export function RequestTable({
  rows,
  tab,
  openId,
  onOpen,
  onDecide,
  onReassign,
  sort,
  onSort,
}: RequestTableProps) {
  // The last columns swap with the tab: while a request is pending there is no
  // actor yet, and once it is settled the remark is stale.
  const headers: { label: string; column?: SortColumn }[] = [
    { label: "Date Submitted", column: "submittedAt" },
    { label: "Pickup Date/Start Date", column: "startDate" },
    { label: "Requestor", column: "requestor" },
    { label: "Location" },
    { label: "From" },
    { label: "To" },
    { label: "Purpose" },
    { label: "Details" },
    { label: "Van Type" },
    { label: "Driver" },
    { label: "Van" },
    { label: "Plate Number" },
    { label: "Status", column: "status" },
    ...(tab === "pending"
      ? [{ label: "Remarks" }]
      : [
          { label: "Updated by" },
          { label: "Last Updated", column: "updatedAt" as SortColumn },
        ]),
  ];

  return (
    // A `section` with an accessible name is already a `region`, so no explicit
    // role is needed. It is focusable because a scroll container that is not
    // reachable by keyboard hides the columns that overflow from anyone not
    // using a pointer — WCAG 2.1.1. Biome's rule models "non-interactive
    // elements must not be focusable" and has no exception for scroll
    // containers, which is the one case where the opposite is required.
    <section
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-reachable scroll container, required by WCAG 2.1.1
      tabIndex={0}
      aria-label="Requests, scrollable horizontally"
      // min-h: `overflow-x: auto` clips on both axes, so the row menu was cut
      // off when the table was shorter than the open menu. Same fix as the
      // requestor's bookings table.
      className="max-w-full min-h-[320px] min-w-0 overflow-x-auto px-5 focus-visible:outline-3 focus-visible:-outline-offset-2 focus-visible:outline-primary md:px-7"
    >
      <table className="w-full min-w-[1800px] border-collapse tabular-nums">
        <thead>
          <tr>
            {headers.map(({ label, column }) => {
              const active = column !== undefined && sort.column === column;
              return (
                <th
                  key={label}
                  scope="col"
                  // `aria-sort` belongs on the cell, not the button inside it —
                  // it describes the COLUMN's order, and a screen reader reads
                  // it when landing on the header.
                  aria-sort={
                    active
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className="border-b border-gray-4 px-4 py-3.5 text-left text-body font-semibold whitespace-nowrap text-gray-1"
                >
                  {column === undefined ? (
                    label
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSort(column)}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-body font-semibold text-gray-1 hover:text-brand",
                        FOCUS_RING,
                      )}
                    >
                      {label}
                      {/* Only the active column carries an arrow. A chevron on
                          every sortable header says nothing about which one is
                          in force. */}
                      {active &&
                        (sort.direction === "asc" ? (
                          <ChevronUp aria-hidden="true" className="size-4" />
                        ) : (
                          <ChevronDown aria-hidden="true" className="size-4" />
                        ))}
                      <span className="sr-only">
                        {active
                          ? `, sorted ${sort.direction === "asc" ? "ascending" : "descending"}`
                          : ", sortable"}
                      </span>
                    </button>
                  )}
                </th>
              );
            })}
            <th
              scope="col"
              className="border-b border-gray-4 px-4 py-3.5 text-right"
            >
              {/* An empty `th` leaves a screen reader announcing the menu button
                  with no column context at all. */}
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pending = row.status === "Pending";
            return (
              <tr
                key={row.id}
                className={
                  row.id === openId
                    ? "border-b border-gray-6 bg-brand-wash"
                    : "border-b border-gray-6"
                }
              >
                <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                  {formatInstant(new Date(row.submittedAt)) ?? EM_DASH}
                </td>
                <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                  {formatPlainDate(row.startDate) ?? EM_DASH}
                  <span className="block text-xs text-gray-2">
                    {formatPlainTime(row.startTime) ?? EM_DASH}
                    {row.endTime !== null &&
                      ` – ${formatPlainTime(row.endTime) ?? EM_DASH}`}
                  </span>
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
                <td className="px-4 py-4 text-body text-gray-1">
                  {row.purpose}
                </td>
                <td className="px-4 py-4 text-body text-gray-1">
                  <span className="line-clamp-2 max-w-[280px]">
                    {row.details}
                  </span>
                </td>
                <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                  {RIDE_MODE_LABELS[row.mode].title}
                </td>
                <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                  <span className="flex items-center gap-2">
                    {row.driver ?? EM_DASH}
                    {row.driverSource === "rental" && <RentalTag />}
                  </span>
                </td>
                <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                  <span className="flex items-center gap-2">
                    {row.vanLabel ?? EM_DASH}
                    {row.vanSource === "rental" && <RentalTag />}
                  </span>
                </td>
                <td className="px-4 py-4 text-body whitespace-nowrap text-gray-1">
                  {row.vanPlate ?? EM_DASH}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <StatusChip status={row.status} />
                </td>
                <td className="px-4 py-4 text-body whitespace-nowrap text-gray-2">
                  {(tab === "pending" ? row.remarks : row.updatedBy) ?? EM_DASH}
                </td>
                {tab !== "pending" && (
                  <td className="px-4 py-4 text-body whitespace-nowrap text-gray-2">
                    {row.updatedAt === null
                      ? EM_DASH
                      : (formatInstant(new Date(row.updatedAt)) ?? EM_DASH)}
                  </td>
                )}
                <td className="px-4 py-4">
                  <RowMenu
                    reference={row.id}
                    actions={[
                      {
                        label: "View trip details",
                        enabled: true,
                        onSelect: () => onOpen(row),
                      },
                      {
                        label: "Reassign van and driver",
                        enabled: isReassignable(row.status),
                        disabledReason:
                          "Only approved requests can be reassigned.",
                        onSelect: () => onReassign(row),
                      },
                      {
                        label: "Approve",
                        enabled: pending,
                        disabledReason: "Only pending requests can be decided.",
                        onSelect: () => onDecide(row, "approve"),
                      },
                      {
                        label: "Reject",
                        enabled: pending,
                        disabledReason: "Only pending requests can be decided.",
                        onSelect: () => onDecide(row, "reject"),
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

/**
 * Shown when the filters match nothing.
 *
 * The design places a bespoke illustration here (`public/figma/empty-list.svg`),
 * which is not among the delivered assets — so the slot is a marked placeholder
 * rather than a substituted drawing. The copy carries the message on its own.
 */
export function EmptyRequests({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-20 text-center">
      {/* SEAM — drop `empty-list.svg` into public/assets/ and replace this
          with an <Image>. It is decorative: keep it aria-hidden with alt="". */}
      <span
        aria-hidden="true"
        className="mb-6 flex size-16 items-center justify-center rounded-pill bg-brand-tint text-brand"
      >
        <SearchX className="size-7" />
      </span>
      <h3 className="mb-2 text-[1.375rem] font-semibold text-plum">{title}</h3>
      <p className="max-w-[440px] text-body text-pretty text-gray-2">{body}</p>
    </div>
  );
}
