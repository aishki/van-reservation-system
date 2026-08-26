// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
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
}));

const { CalendarView } = await import(
  "@/components/admin/calendar/calendar-view"
);

afterEach(cleanup);

/** The fixture week containing REQ-1049 (Mon 2026-08-03 – Sun 2026-08-09). */
const TODAY = "2026-08-05";
const TARGET = "REQ-1049";

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

  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/reservations/")) {
      const row = sampleAdminRequests().find(
        (candidate) => candidate.id === TARGET,
      );
      if (row === undefined) throw new Error("fixture REQ-1049 is missing");
      return Promise.resolve(reservationDetailFrom(row));
    }
    return Promise.resolve([]);
  });
});

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      <TooltipProvider delay={0}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

function renderCalendar() {
  render(
    <Providers>
      <CalendarView
        rows={sampleAdminRequests()}
        today={TODAY}
        adminName="Balandra, Ivy"
      />
    </Providers>,
  );
}

const block = () =>
  screen.getByRole("button", { name: new RegExp(`Trip ${TARGET}`) });

describe("CalendarView legend", () => {
  it("explains PENDING as either side of the assignment missing", () => {
    // `awaitingAssignment` fires for a missing driver OR a missing van, so the
    // legend must not read as if only the driver could be the reason.
    render(
      <Providers>
        <CalendarView rows={[]} today="2026-08-10" adminName="Balandra, Ivy" />
      </Providers>,
    );
    expect(screen.getByText("driver or van not assigned")).not.toBeNull();
  });
});

describe("CalendarView blocks", () => {
  // The block is a few words wide; the name is what a screen reader gets.
  it("names the trip in the block's accessible name", () => {
    renderCalendar();
    expect(
      screen.getByRole("button", {
        name: new RegExp(`Trip ${TARGET}.*Jimera.*Manila`),
      }),
    ).toBeDefined();
  });

  // Waits for the drawer's own content, not just any dialog: the loading
  // placeholder is a dialog too, and it resolves first.
  it("opens the trip drawer for the block that was clicked", async () => {
    renderCalendar();
    fireEvent.click(block());

    await screen.findByRole("combobox", { name: "Driver" });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(TARGET)).toBeDefined();
  });

  /**
   * Driven by FOCUS, not hover.
   *
   * Base UI's hover detection does not fire under jsdom's synthetic pointer
   * events, so `hint.test.tsx` drives this same tooltip through focus too. Both
   * paths open the one `Hint`, so what is asserted here — that the preview
   * carries the whole trip, which the block itself is far too small to show —
   * holds for a pointer user as well. It is also the keyboard user's only way
   * in, which is reason enough to pin it.
   */
  it("shows the full trip in the preview", async () => {
    renderCalendar();
    fireEvent.focus(block());

    // None of these three appear on the block itself.
    expect(await screen.findByText("SLT Appointments")).toBeDefined();
    expect(screen.getByText(/^Driver:/)).toBeDefined();
    expect(screen.getByText(/^Van:/)).toBeDefined();
  });

  it("names the trip in the preview so the block is identifiable", async () => {
    renderCalendar();
    fireEvent.focus(block());

    const purpose = await screen.findByText("SLT Appointments");
    expect(purpose.closest("div")?.textContent).toContain(TARGET);
  });
});

/**
 * Three trips contesting one span on the fixture week's Monday, so the calendar
 * has a real stack to collapse. Standby rows, so `endTime` actually bounds them.
 */
function overlapping(count: number): ReservationRow[] {
  const base = sampleAdminRequests()[0];
  return Array.from({ length: count }, (_, index) => ({
    ...base,
    id: `REQ-90${index}`,
    status: "Approved" as const,
    startDate: "2026-08-05",
    startTime: "08:00",
    endTime: "12:00",
    requestor: `Tester ${index}`,
  }));
}

function renderRows(rows: ReservationRow[]) {
  render(
    <Providers>
      <CalendarView rows={rows} today={TODAY} adminName="Balandra, Ivy" />
    </Providers>,
  );
}

describe("CalendarView stacking", () => {
  // Two half-width blocks are still readable; collapsing them would hide
  // information that currently fits.
  it("draws two overlapping trips side by side", () => {
    renderRows(overlapping(2));
    expect(screen.getByRole("button", { name: /Trip REQ-900/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Trip REQ-901/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /trips on this block/ })).toBe(
      null,
    );
  });

  it("collapses three overlapping trips into one block", () => {
    renderRows(overlapping(3));
    expect(
      screen.getByRole("button", { name: /3 trips on this block/ }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /Trip REQ-900/ })).toBeNull();
  });

  it("lists the trips when the stack is opened", () => {
    renderRows(overlapping(3));
    const stack = screen.getByRole("button", {
      name: /3 trips on this block/,
    });
    expect(stack.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(stack);
    expect(stack.getAttribute("aria-expanded")).toBe("true");
    for (const id of ["REQ-900", "REQ-901", "REQ-902"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(id) }),
      ).toBeDefined();
    }
  });

  it("opens the drawer for the trip chosen from a stack", async () => {
    renderRows(overlapping(3));
    fireEvent.click(
      screen.getByRole("button", { name: /3 trips on this block/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /REQ-901/ }));

    await screen.findByRole("combobox", { name: "Driver" });
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("collapses again on Escape", () => {
    renderRows(overlapping(3));
    const stack = screen.getByRole("button", {
      name: /3 trips on this block/,
    });
    fireEvent.click(stack);
    expect(stack.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(stack, { key: "Escape" });
    expect(stack.getAttribute("aria-expanded")).toBe("false");
  });

  it("collapses again on a second click", () => {
    renderRows(overlapping(3));
    const stack = screen.getByRole("button", {
      name: /3 trips on this block/,
    });
    fireEvent.click(stack);
    fireEvent.click(stack);
    expect(stack.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /^REQ-901/ })).toBeNull();
  });
});
