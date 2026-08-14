// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EM_DASH } from "@/lib/tz";
import { blankAdminFilter } from "@/modules/reservations/admin-filters";
import type { ReservationRow } from "@/modules/reservations/types";
import { RequestTable } from "./request-table";

afterEach(cleanup);

function row(overrides: Partial<ReservationRow> = {}): ReservationRow {
  return {
    id: "REQ-0001",
    submittedAt: "2026-08-01T00:00:00Z",
    startDate: "2026-08-10",
    startTime: "08:00",
    endTime: null,
    requestor: "Dela Cruz, Juan",
    site: "Manila",
    from: "GLS",
    to: "AGT",
    mode: "pickup",
    purpose: "Onshore/Client Visit",
    details: "Test fixture trip.",
    status: "Pending",
    updatedBy: null,
    updatedAt: null,
    remarks: null,
    driver: null,
    driverId: null,
    driverSource: null,
    vanLabel: null,
    vanSource: null,
    vanPlate: null,
    ...overrides,
  };
}

const noop = vi.fn();

describe("RequestTable driver and van columns", () => {
  it("shows the driver and van, tagging each rental side independently", () => {
    render(
      <RequestTable
        rows={[
          row({
            id: "REQ-1",
            driver: "Aduana, Ian",
            driverSource: "roster",
            vanLabel: "VAN-003",
            vanSource: "roster",
          }),
          row({
            id: "REQ-2",
            driver: "Rental Ramos",
            driverSource: "rental",
            vanLabel: "RENT 0007",
            vanSource: "rental",
          }),
          row({
            id: "REQ-3",
            driver: "Aduana, Ian",
            driverSource: "roster",
            vanLabel: "RENT 0008",
            vanSource: "rental",
          }),
        ]}
        tab="pending"
        openId={null}
        onOpen={noop}
        onDecide={noop}
        onReassign={noop}
        sort={blankAdminFilter().sort.pending}
        onSort={noop}
      />,
    );
    expect(screen.getByText("VAN-003")).not.toBeNull();
    // Two rental vans, one rental driver — the sides are independent.
    expect(screen.getAllByText("Rental")).toHaveLength(3);
  });

  it("renders an em dash for an unassigned driver or van", () => {
    render(
      <RequestTable
        rows={[row({ driver: null, vanLabel: null, vanPlate: null })]}
        tab="pending"
        openId={null}
        onOpen={noop}
        onDecide={noop}
        onReassign={noop}
        sort={blankAdminFilter().sort.pending}
        onSort={noop}
      />,
    );
    expect(screen.getAllByText(EM_DASH).length).toBeGreaterThan(0);
  });

  it("shows the roster van's real plate and the rental's plate as distinct values", () => {
    render(
      <RequestTable
        rows={[
          row({
            id: "REQ-1",
            vanLabel: "VAN-003",
            vanSource: "roster",
            vanPlate: "NHU 8001",
          }),
          row({
            id: "REQ-2",
            vanLabel: "RENT 0007",
            vanSource: "rental",
            vanPlate: "ABC 1234",
          }),
        ]}
        tab="pending"
        openId={null}
        onOpen={noop}
        onDecide={noop}
        onReassign={noop}
        sort={blankAdminFilter().sort.pending}
        onSort={noop}
      />,
    );
    // The Plate Number column carries the real plate for both sides, and the
    // two must read as different vehicles — that is the point of the column.
    expect(screen.getByText("NHU 8001")).not.toBeNull();
    expect(screen.getByText("ABC 1234")).not.toBeNull();
  });
});

describe("RequestTable purpose and details columns", () => {
  it("shows purpose and clamped details", () => {
    render(
      <RequestTable
        rows={[row({ purpose: "Team Building", details: "A".repeat(300) })]}
        tab="pending"
        openId={null}
        onOpen={noop}
        onDecide={noop}
        onReassign={noop}
        sort={blankAdminFilter().sort.pending}
        onSort={noop}
      />,
    );
    expect(screen.getByText("Team Building")).not.toBeNull();
    expect(screen.getByText("A".repeat(300)).className).toContain(
      "line-clamp-2",
    );
  });
});

describe("RequestTable sortable headers", () => {
  const renderWith = (
    sort = blankAdminFilter().sort.all,
    onSort = vi.fn(),
    tab: "pending" | "all" = "all",
  ) => {
    render(
      <RequestTable
        rows={[row({ id: "REQ-1" })]}
        tab={tab}
        openId={null}
        onOpen={noop}
        onDecide={noop}
        onReassign={noop}
        sort={sort}
        onSort={onSort}
      />,
    );
    return onSort;
  };

  const header = (name: RegExp) => screen.getByRole("columnheader", { name });

  it("marks only the active column as sorted", () => {
    renderWith({ column: "updatedAt", direction: "desc" });
    expect(header(/^Last Updated/).getAttribute("aria-sort")).toBe(
      "descending",
    );
    expect(header(/^Date Submitted/).getAttribute("aria-sort")).toBe("none");
  });

  it("reports the direction it is actually sorted in", () => {
    renderWith({ column: "requestor", direction: "asc" });
    expect(header(/^Requestor/).getAttribute("aria-sort")).toBe("ascending");
  });

  it("asks for a column when its header is clicked", () => {
    const onSort = renderWith();
    fireEvent.click(screen.getByRole("button", { name: /^Date Submitted/ }));
    expect(onSort).toHaveBeenCalledWith("submittedAt");
  });

  // A header that cannot reorder anything must not look like it can.
  it("renders no button in a column that cannot be sorted", () => {
    renderWith();
    expect(screen.queryByRole("button", { name: /^Purpose/ })).toBeNull();
    expect(header(/^Purpose/).getAttribute("aria-sort")).toBe("none");
  });

  it("offers no Last Updated column on the Pending tab", () => {
    renderWith(blankAdminFilter().sort.pending, vi.fn(), "pending");
    expect(screen.queryByRole("columnheader", { name: /Last Updated/ })).toBe(
      null,
    );
  });
});
