// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeQueryClient } from "@/lib/query-client";
import type { AdminEntry } from "@/modules/admins/types";
import type { Driver } from "@/modules/drivers/types";
import type { Van } from "@/modules/vans/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { RosterView } = await import("@/components/admin/roster/roster-view");

afterEach(cleanup);

beforeEach(() => {
  // jsdom implements neither, and the forms open as real modals.
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

// Explicit annotations, not just `const DRIVERS = [...]`: without them TS
// widens `site` to `string`, which does not satisfy `Driver["site"]`'s
// `"Iloilo" | "Manila"` literal union.
const DRIVERS: Driver[] = [
  {
    id: "d1",
    name: "Ronald Japitana",
    mobile: "09171234567",
    site: "Iloilo",
    shift: null,
    active: true,
  },
  {
    id: "d2",
    name: "Dennis Ocampo",
    mobile: "09990001111",
    site: "Manila",
    shift: "11AM-11PM",
    active: false,
  },
];
const VANS: Van[] = [
  {
    id: "v1",
    vanNumber: "VAN-001",
    plate: "ABC 1234",
    carType: "Hi Ace",
    site: "Iloilo",
    active: true,
  },
];
const ADMINS: AdminEntry[] = [
  {
    id: "a1",
    fullName: "Jimera, Arielle",
    email: "arielle@x.invalid",
    domainId: "AM65108",
    site: "all",
    notify: true,
    active: true,
    superAdmin: true,
  },
];

function renderRoster(overrides = {}) {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RosterView
        drivers={DRIVERS}
        vans={VANS}
        admins={ADMINS}
        adminName="Balandra, Ivy"
        superAdmin={false}
        today="2026-09-01"
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

describe("RosterView tabs", () => {
  it("shows the drivers tab first", () => {
    renderRoster();
    expect(screen.getByText("Ronald Japitana")).toBeDefined();
  });

  it("hides the Admins tab from a non-super-admin", () => {
    renderRoster();
    expect(screen.queryByRole("button", { name: /Admins/ })).toBeNull();
  });

  it("hides the Admins tab on the `superAdmin` prop alone, even with admin rows in hand", () => {
    // RosterView never reads a session — `superAdmin` IS the whole contract.
    // Passing real admin data alongside `superAdmin: false` (as a stale or
    // forged prop would) must still hide the tab and never render a row from
    // it, matching the page never sending that data to a non-holder either.
    renderRoster({ superAdmin: false, admins: ADMINS });
    expect(screen.queryByRole("button", { name: /Admins/ })).toBeNull();
    expect(screen.queryByText("Jimera, Arielle")).toBeNull();
  });

  it("shows the Admins tab to a super-admin", () => {
    renderRoster({ superAdmin: true });
    expect(screen.getByRole("button", { name: /Admins/ })).toBeDefined();
  });

  it("switches to vans when the Vans tab is pressed", () => {
    renderRoster();
    fireEvent.click(screen.getByRole("button", { name: /Vans/ }));
    expect(screen.getByText("VAN-001")).toBeDefined();
    expect(screen.queryByText("Ronald Japitana")).toBeNull();
  });

  it("carries aria-pressed on the tabs, not aria-current", () => {
    // They rearrange a view in place; aria-current announces the current item in
    // a set of NAVIGATION targets, and nothing here navigates. Matches the
    // Master List's filters.
    renderRoster();
    const drivers = screen.getByRole("button", { name: /Drivers/ });
    expect(drivers.getAttribute("aria-pressed")).toBe("true");
    expect(drivers.getAttribute("aria-current")).toBeNull();
  });
});

describe("RosterView tables", () => {
  it("marks an inactive driver as inactive rather than hiding them", () => {
    // listDrivers returns inactive rows deliberately — history must render.
    renderRoster();
    const row = screen.getByText("Dennis Ocampo").closest("tr");
    expect(within(row as HTMLElement).getByText(/Inactive/)).toBeDefined();
  });

  it("offers Deactivate on an active row and Reactivate on an inactive one", () => {
    renderRoster();
    const active = screen.getByText("Ronald Japitana").closest("tr");
    const inactive = screen.getByText("Dennis Ocampo").closest("tr");
    expect(
      within(active as HTMLElement).getByRole("button", { name: /Deactivate/ }),
    ).toBeDefined();
    expect(
      within(inactive as HTMLElement).getByRole("button", {
        name: /Reactivate/,
      }),
    ).toBeDefined();
  });

  it("has no Delete control anywhere", () => {
    // Deactivation is the whole of retirement — deleting a driver would orphan
    // every trip they have driven.
    renderRoster({ superAdmin: true });
    expect(screen.queryByRole("button", { name: /Delete/i })).toBeNull();
  });
});
