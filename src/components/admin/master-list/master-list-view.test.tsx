// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeQueryClient } from "@/lib/query-client";
import type { ReservationRow } from "@/modules/reservations/types";
import {
  reservationDetailFrom,
  sampleAdminRequests,
} from "@/test-fixtures/reservations";

const apiFetchMock = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetcher", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  ApiError: class MockApiError extends Error {
    code: string;
    status: number;
    details?: unknown;
    constructor(
      code: string,
      message: string,
      status: number,
      details?: unknown,
    ) {
      super(message);
      this.code = code;
      this.status = status;
      this.details = details;
    }
  },
}));

const { MasterListView } = await import(
  "@/components/admin/master-list/master-list-view"
);

/** Ids follow `sampleReservationDetail`'s `driver-<slug>` convention. */
const ROSTER = [
  {
    id: "driver-villanueva-rey",
    name: "Villanueva, Rey",
    mobile: "09171234567",
    site: "Manila",
    shift: "11AM-11PM",
    active: true,
  },
];

const FLEET = [
  {
    id: "van-van-03",
    vanNumber: "VAN-003",
    plate: "NHU 8003",
    carType: "Urvan",
    site: "Iloilo",
    active: true,
  },
];

/** REQ-1051 — the pending fixture, no driver and no van assigned. */
const REFERENCE = "REQ-1051";

/**
 * What the SERVER holds. The PATCH handler below mutates it exactly as
 * `decideReservation` would, and `GET /api/reservations` answers from it — so a
 * table that re-reads the server sees the assignment and a table painting a
 * local copy does not.
 */
let serverRows: ReservationRow[];

function rowOf(rows: ReservationRow[], id: string): ReservationRow {
  const found = rows.find((row) => row.id === id);
  if (found === undefined) throw new Error(`fixture ${id} is missing`);
  return found;
}

beforeEach(() => {
  // jsdom implements neither, and the drawer opens as a real modal.
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });

  serverRows = sampleAdminRequests();
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/api/drivers") return Promise.resolve(ROSTER);
    if (path === "/api/vans") return Promise.resolve(FLEET);
    if (path === "/api/reservations") return Promise.resolve(serverRows);

    // Checked before the detail branch below: a PATCH and a detail GET share
    // one path and differ only by method.
    if (init?.method === "PATCH") {
      const body = JSON.parse(init.body as string);
      serverRows = serverRows.map((row) =>
        row.id === REFERENCE
          ? {
              ...row,
              status: body.decision === "approve" ? "Approved" : row.status,
              driver: "Villanueva, Rey",
              driverId: "driver-villanueva-rey",
              driverSource: "roster",
              vanLabel: "VAN-003",
              vanSource: "roster",
              vanPlate: "NHU 8003",
              updatedBy: "Balandra, Ivy",
            }
          : row,
      );
      return Promise.resolve({
        reference: REFERENCE,
        status: body.decision === "approve" ? "approved" : "pending",
        version: 2,
      });
    }

    if (path.startsWith("/api/reservations/")) {
      return Promise.resolve(
        reservationDetailFrom(rowOf(serverRows, REFERENCE)),
      );
    }
    return Promise.reject(new Error(`unexpected fetch: ${path}`));
  });
});

afterEach(cleanup);

// The REAL client, not a bare `new QueryClient()`. Its 30-second `staleTime` is
// what makes `initialData` cost no fetch on mount; a default client treats
// seeded data as stale immediately and refetches, which would hide whether the
// list is actually being invalidated or merely re-fetched on every render.
function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function setup() {
  render(
    <Providers>
      <MasterListView
        initialRows={sampleAdminRequests()}
        adminName="Balandra, Ivy"
      />
    </Providers>,
  );
}

/** Opens the drawer for REQ-1051 through its row menu, as an admin would. */
async function openDrawer() {
  fireEvent.click(
    screen.getByRole("button", { name: `Actions for ${REFERENCE}` }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "View trip details" }));
  await screen.findByRole("combobox", { name: "Driver" });
}

const assignBoth = async () => {
  await screen.findByRole("option", { name: /Villanueva, Rey/ });
  fireEvent.change(screen.getByRole("combobox", { name: "Driver" }), {
    target: { value: "driver-villanueva-rey" },
  });
  await screen.findByRole("option", { name: /VAN-003/ });
  fireEvent.change(screen.getByRole("combobox", { name: "Van" }), {
    target: { value: "van-van-03" },
  });
};

const save = () =>
  fireEvent.click(
    screen.getByRole("button", { name: /save|approve &|reject &/i }),
  );

/** The Master List tab, where a decided request lands. */
const showAllRequests = () =>
  fireEvent.click(screen.getByRole("button", { name: /Master List/ }));

/**
 * REQ-1051's `<tr>`.
 *
 * Scoped rather than searched globally: other fixture rows name the same driver
 * and van, so a bare `getByText("Villanueva, Rey")` would pass on somebody
 * else's row and say nothing about the one that was just saved.
 */
function rowFor(reference: string): HTMLElement {
  const row = screen
    .getByRole("button", { name: `Actions for ${reference}` })
    .closest("tr");
  if (row === null) throw new Error(`no row rendered for ${reference}`);
  return row;
}

/**
 * The table's rows are the server's rows.
 *
 * These are regression tests for a specific defect: the view held
 * `useState(initialRows)` and, on a decision, patched `status` and `updatedBy`
 * into that copy. Every other column the same save had changed kept its
 * pre-save value until Next's router cache expired minutes later — so an
 * approved request showed as Approved with an empty driver and van, next to a
 * drawer that showed both assigned. A save with no decision patched nothing at
 * all.
 */
describe("MasterListView after a save", () => {
  it("shows the driver, van and plate the approval assigned", async () => {
    setup();
    await openDrawer();
    await assignBoth();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    save();

    // The row leaves Pending on approval, so read it on the Master List tab.
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/reservations"),
    );
    showAllRequests();

    await waitFor(() => {
      const row = within(rowFor(REFERENCE));
      expect(row.getByText("Villanueva, Rey")).toBeDefined();
      expect(row.getByText("VAN-003")).toBeDefined();
      expect(row.getByText("NHU 8003")).toBeDefined();
      expect(row.getByText("Approved")).toBeDefined();
    });
  });

  // The case the old code could not reach at all: `onDecided` never fired, so
  // nothing repainted even in principle.
  it("shows an assignment made without a decision", async () => {
    setup();
    await openDrawer();
    await assignBoth();
    save();

    // Still Pending, so the row is on the tab it started on.
    await waitFor(() => {
      const row = within(rowFor(REFERENCE));
      expect(row.getByText("Villanueva, Rey")).toBeDefined();
      expect(row.getByText("VAN-003")).toBeDefined();
      expect(row.getByText("Pending")).toBeDefined();
    });
  });

  it("refetches the list rather than trusting the copy it was rendered with", async () => {
    setup();
    // Nothing is fetched on load: `initialData` seeds the cache with the
    // server-rendered rows, so the fix costs no extra request.
    expect(apiFetchMock).not.toHaveBeenCalledWith("/api/reservations");

    await openDrawer();
    await assignBoth();
    save();

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/reservations"),
    );
  });
});

/**
 * The Master List defaults to everything except Pending.
 *
 * An admin who has just approved a request opens this tab to confirm it landed;
 * repeating the Pending queue here buried that row under the requests the tab
 * beside it already shows.
 */
describe("MasterListView status filter", () => {
  // Exact by default, so this does not also match the "Pending Request" tab.
  const statusButton = (label: string) =>
    screen.getByRole("button", { name: label });

  it("hides pending rows on the Master List by default", () => {
    setup();
    showAllRequests();

    // REQ-1051 is Pending, REQ-1049 is Approved.
    expect(
      screen.queryByRole("button", { name: "Actions for REQ-1051" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Actions for REQ-1049" }),
    ).toBeDefined();
  });

  it("reveals pending rows once Pending is selected", () => {
    setup();
    showAllRequests();
    fireEvent.click(statusButton("Pending"));

    expect(
      screen.getByRole("button", { name: "Actions for REQ-1051" }),
    ).toBeDefined();
  });

  // Deselecting everything must mean "nothing", not silently mean its own
  // opposite — an admin still seeing every row would read the control as broken.
  it("says so when no status is selected", () => {
    setup();
    showAllRequests();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByText("No statuses selected")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Actions for REQ-1049" }),
    ).toBeNull();
  });

  it("brings every row back with Select all", () => {
    setup();
    showAllRequests();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));

    expect(
      screen.getByRole("button", { name: "Actions for REQ-1051" }),
    ).toBeDefined();
  });

  // The Pending tab is the review queue by definition.
  it("shows no status control on the Pending tab", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});
