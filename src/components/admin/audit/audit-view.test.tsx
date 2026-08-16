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
import type { AuditEntry } from "@/modules/audit/types";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api-fetcher", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const { AuditView } = await import("@/components/admin/audit/audit-view");
type AuditPageData =
  import("@/components/admin/audit/audit-view").AuditPageData;

afterEach(cleanup);
beforeEach(() => {
  apiFetchMock.mockReset();
  // A default so a test that only cares about the source toggle firing does
  // not have to stub a response — tests that care what comes back override it.
  apiFetchMock.mockResolvedValue({ entries: [], nextCursor: null });
});

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    at: "2026-08-05T01:00:00.000Z",
    action: "modified",
    actorName: "Balandra, Ivy",
    reference: "VR-2026-000412",
    requestor: "Jimera, Arielle",
    site: "Manila",
    startDate: "2026-08-11",
    purpose: "Travel-Related (Airport Transfers)",
    remark: null,
    changes: { kind: "none" },
    ...overrides,
  };
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function setup(initial: AuditPageData) {
  render(
    <Providers>
      <AuditView initial={initial} />
    </Providers>,
  );
}

/** A default reservations-source render, for tests that only care about the
 * source toggle rather than the seeded reservation row. */
function renderAudit() {
  setup(page([entry()]));
}

const page = (
  entries: AuditEntry[],
  nextCursor: AuditPageData["nextCursor"] = null,
): AuditPageData => ({ entries, nextCursor });

describe("AuditView", () => {
  it("renders both sides of a recorded change", () => {
    setup(
      page([
        entry({
          changes: {
            kind: "fields",
            changes: [
              {
                field: "pickupPoint",
                label: "Pickup point",
                from: "Smallville",
                to: "CGS Office",
              },
            ],
          },
        }),
      ]),
    );

    expect(screen.getByText(/Pickup point/)).toBeDefined();
    expect(screen.getByText(/Smallville/)).toBeDefined();
    expect(screen.getByText(/CGS Office/)).toBeDefined();
  });

  // A first assignment legitimately has no "from"; it must not read as a blank
  // cell that looks like missing data.
  it("renders an em dash for a side that held nothing", () => {
    setup(
      page([
        entry({
          action: "driver_assigned",
          changes: {
            kind: "fields",
            changes: [
              {
                field: "driver",
                label: "Driver",
                from: null,
                to: "Villanueva, Rey",
              },
            ],
          },
        }),
      ]),
    );

    expect(screen.getByText("—")).toBeDefined();
    expect(screen.getByText(/Villanueva, Rey/)).toBeDefined();
  });

  // These rows predate the log capturing values. Saying so is honest;
  // pretending to a diff is not.
  it("says so when a legacy row recorded no values", () => {
    setup(page([entry({ changes: { kind: "names", fields: ["purpose"] } })]));

    expect(screen.getByText("values not recorded")).toBeDefined();
  });

  it("renders a rejection's reason", () => {
    setup(
      page([
        entry({ action: "rejected", remark: "No van available that week." }),
      ]),
    );

    expect(screen.getByText("No van available that week.")).toBeDefined();
  });

  // Scoped to the table: the filter dropdown carries the same labels.
  it("names the action in words, not the event type", () => {
    setup(page([entry({ action: "driver_reassigned" })]));
    const cells = within(screen.getByRole("table")).getAllByRole("cell");
    expect(cells.some((cell) => cell.textContent === "Reassigned driver")).toBe(
      true,
    );
    expect(
      cells.some((cell) => cell.textContent?.includes("driver_reassigned")),
    ).toBe(false);
  });

  it("does not fetch on load — the first page is server-rendered", () => {
    setup(page([entry()]));
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("offers no Load more on the last page", () => {
    setup(page([entry()]));
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("asks for the next page with the cursor it was given, and appends", async () => {
    const cursor = {
      at: "2026-08-05T01:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
    };
    apiFetchMock.mockResolvedValue(
      page([
        entry({
          id: "22222222-2222-4222-8222-222222222222",
          reference: "VR-2026-000999",
        }),
      ]),
    );

    setup(page([entry()], cursor));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(screen.getByText("VR-2026-000999")).toBeDefined();
    });
    expect(String(apiFetchMock.mock.calls[0][0])).toContain(
      `cursor=${encodeURIComponent(`${cursor.at}|${cursor.id}`)}`,
    );
    // The first page is still on screen — Load more appends, it does not replace.
    expect(screen.getByText("VR-2026-000412")).toBeDefined();
  });

  // A filter change is a different question. Appending its answer to the old
  // one would leave rows on screen that no longer match the filter.
  it("replaces rather than appends when a filter changes", async () => {
    apiFetchMock.mockResolvedValue(
      page([
        entry({
          id: "33333333-3333-4333-8333-333333333333",
          reference: "VR-2026-000777",
          action: "approved",
        }),
      ]),
    );

    setup(page([entry()]));
    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "approved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.getByText("VR-2026-000777")).toBeDefined();
    });
    expect(screen.queryByText("VR-2026-000412")).toBeNull();
    expect(String(apiFetchMock.mock.calls[0][0])).toContain("action=approved");
  });

  // Otherwise roster rows append to reservation rows and the table mixes two
  // logs with different columns.
  it("starts a fresh page set when the source changes", async () => {
    renderAudit();
    fireEvent.click(screen.getByRole("button", { name: /Roster/ }));
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringContaining("source=roster"),
      );
    });
  });

  it("does not seed roster results with the reservation initialData", async () => {
    renderAudit();
    // The reservation row is on screen from `initialData` before the switch.
    expect(screen.getByText("VR-2026-000412")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Roster/ }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());

    // Fresh query key, no seed: the reservation row disappears rather than
    // carrying over into the roster table, which has different columns.
    await waitFor(() => {
      expect(screen.queryByText("VR-2026-000412")).toBeNull();
    });
  });
});
