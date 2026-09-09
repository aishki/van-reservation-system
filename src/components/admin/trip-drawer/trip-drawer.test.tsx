// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DECISION_MESSAGES } from "@/modules/reservations/decision";
import type {
  ReservationDetail,
  ReservationRow,
} from "@/modules/reservations/types";
import {
  reservationDetailFrom,
  sampleAdminRequests,
  sampleReservationDetail,
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

const { TripDrawer } = await import(
  "@/components/admin/trip-drawer/trip-drawer"
);
type TripDrawerMode =
  import("@/components/admin/trip-drawer/trip-drawer").TripDrawerMode;
const { ApiError } = await import("@/lib/api-fetcher");
const { toast } = await import("sonner");

/** Ids match `sampleReservationDetail`'s `driver-<slug>` convention. */
const ROSTER = [
  {
    id: "driver-villanueva-rey",
    name: "Villanueva, Rey",
    mobile: "09171234567",
    site: "Manila",
    shift: "11AM-11PM",
    active: true,
  },
  {
    id: "driver-ocampo-dennis",
    name: "Ocampo, Dennis",
    mobile: "09179876543",
    site: "Manila",
    shift: "11PM-11AM",
    active: true,
  },
];

/**
 * Ids match `sampleReservationDetail`'s `van-<slug(vanLabel)>` convention, so a
 * request's stored van is a member of this fleet rather than an orphan id its
 * select cannot show. `sampleVans()` numbers its own ids differently, which is
 * why the roster above is local too.
 */
const FLEET = [
  {
    id: "van-van-01",
    vanNumber: "VAN-001",
    plate: "NHU 8001",
    carType: "Hi Ace Super Grandia",
    site: "Manila",
    active: true,
  },
  {
    id: "van-van-02",
    vanNumber: "VAN-002",
    plate: "NHU 8002",
    carType: "Hi Ace Super Grandia",
    site: "Manila",
    active: true,
  },
  {
    id: "van-van-03",
    vanNumber: "VAN-003",
    plate: "NHU 8003",
    carType: "Urvan",
    site: "Iloilo",
    active: true,
  },
  {
    id: "van-van-09",
    vanNumber: "VAN-009",
    plate: "NHU 8009",
    carType: "Urvan",
    site: "Manila",
    active: false,
  },
];

// jsdom implements neither `showModal` nor `close`. Stubbing them is enough for
// these tests, which are about the decision rules rather than the dialog's
// focus trap — that behaviour is the browser's, not this component's.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });

  apiFetchMock.mockReset();
  mockApi(() =>
    Promise.resolve({ reference: "REQ-1051", status: "pending", version: 2 }),
  );
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(cleanup);

/** Both roster fetches, plus whatever the PATCH should answer with. */
function mockApi(patch: () => Promise<unknown>) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === "/api/drivers") return Promise.resolve(ROSTER);
    if (path === "/api/vans") return Promise.resolve(FLEET);
    return patch();
  });
}

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** REQ-1051 — pending, pickup, no driver assigned. */
function pendingPickup(): ReservationDetail {
  const detail = sampleReservationDetail("REQ-1051");
  if (detail === null) throw new Error("fixture REQ-1051 is missing");
  return detail;
}

/** REQ-1038 — approved standby, driver already assigned. */
function approvedStandby(): ReservationDetail {
  const detail = sampleReservationDetail("REQ-1038");
  if (detail === null) throw new Error("fixture REQ-1038 is missing");
  return detail;
}

function setup(
  detail: ReservationDetail = pendingPickup(),
  options: { mode?: TripDrawerMode } = {},
) {
  const onDecided = vi.fn();
  const onClose = vi.fn();
  render(
    <Providers>
      <TripDrawer
        detail={detail}
        adminName="Balandra, Ivy"
        initialDecision={null}
        mode={options.mode}
        onClose={onClose}
        onDecided={onDecided}
      />
    </Providers>,
  );
  return { onDecided, onClose };
}

const save = () =>
  fireEvent.click(
    screen.getByRole("button", { name: /save|approve &|reject &/i }),
  );

const driverSelect = () => screen.getByRole("combobox", { name: "Driver" });

/** Resolves once the roster query has populated the select. */
const rosterLoaded = () =>
  screen.findByRole("option", { name: /Villanueva, Rey/ });

const chooseDriver = async (id: string) => {
  await rosterLoaded();
  fireEvent.change(driverSelect(), { target: { value: id } });
};

const vanSelect = () => screen.getByRole("combobox", { name: "Van" });

/** Resolves once the fleet query has populated the select. */
const fleetLoaded = () => screen.findByRole("option", { name: /VAN-003/ });

const chooseVan = async (id: string) => {
  await fleetLoaded();
  fireEvent.change(vanSelect(), { target: { value: id } });
};

/** An approval now needs both sides, so most tests assign both. */
const assignBoth = async (driverId: string, vanId: string) => {
  await chooseDriver(driverId);
  await chooseVan(vanId);
};

/** REQ-1049's row, with the assignment a test needs. */
function detailWith(overrides: Partial<ReservationRow>): ReservationDetail {
  const row = sampleAdminRequests().find(
    (candidate) => candidate.id === "REQ-1049",
  );
  if (row === undefined) throw new Error("fixture REQ-1049 is missing");
  return reservationDetailFrom({ ...row, ...overrides });
}

/** The body of the PATCH the drawer sent, parsed. */
function patchBody(): Record<string, unknown> {
  const call = apiFetchMock.mock.calls.find(([path]) =>
    String(path).startsWith("/api/reservations/"),
  );
  if (call === undefined) throw new Error("no PATCH was sent");
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe("TripDrawer", () => {
  it("opens as a real modal, not a plain open dialog", () => {
    // `<dialog open>` looks the same and provides no focus trap, no inert
    // backdrop and no Escape handling. Only showModal() does.
    setup();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("shows the request's reference and status", () => {
    setup();
    expect(screen.getByText("REQ-1051")).toBeDefined();
    expect(screen.getByText("Pending")).toBeDefined();
  });

  it("names the signed-in admin as the approver", () => {
    setup();
    expect(screen.getByRole("textbox", { name: "Approver" })).toHaveProperty(
      "value",
      "Balandra, Ivy",
    );
  });
});

describe("TripDrawer approval", () => {
  // FR-13 and the schema's CHECK (status <> 'approved' OR assigned_driver_id IS
  // NOT NULL). The design offers no such check, so its Approve produces a write
  // the database refuses.
  it("refuses to approve without a driver and says which field is wrong", () => {
    const { onDecided } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    save();

    expect(screen.getByText(DECISION_MESSAGES.driverRequired)).toBeDefined();
    expect(onDecided).not.toHaveBeenCalled();
    expect(
      apiFetchMock.mock.calls.some(([path]) =>
        String(path).startsWith("/api/reservations/"),
      ),
    ).toBe(false);
  });

  it("opens the section holding the offending field", () => {
    // An error message pointing into a collapsed accordion points at nothing.
    setup();
    const drivers = screen
      .getByText("Driver & Van")
      .closest("details") as HTMLDetailsElement;
    expect(drivers.open).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    save();
    expect(drivers.open).toBe(true);
  });

  it("approves with the chosen driver's id and the version it read", async () => {
    const { onDecided } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await assignBoth("driver-villanueva-rey", "van-van-03");
    save();

    expect(screen.queryByText(DECISION_MESSAGES.driverRequired)).toBeNull();
    await vi.waitFor(() =>
      expect(onDecided).toHaveBeenCalledWith({
        id: "REQ-1051",
        status: "Approved",
        decidedBy: "Balandra, Ivy",
      }),
    );
    expect(patchBody()).toEqual({
      version: 1,
      decision: "approve",
      rejectionReason: "",
      driver: { source: "roster", driverId: "driver-villanueva-rey" },
      van: { source: "roster", vanId: "van-van-03" },
      // Not ticked, so an approval is never recorded as a trip edit.
      trip: null,
    });
  });

  it("carries an already-assigned driver forward", async () => {
    // Reopening an approved request must not present its driver as unset and
    // then refuse to save.
    setup(approvedStandby());
    await rosterLoaded();
    expect(driverSelect()).toHaveProperty("value", "driver-ocampo-dennis");
  });

  it("shows the selected driver's contact details as readouts", async () => {
    // They belong to the `drivers` row: `reservations` stores only the id, so
    // an editable copy here would be silently discarded on save.
    setup();
    await chooseDriver("driver-villanueva-rey");

    for (const [label, value] of [
      ["Driver's Mobile Number", "09171234567"],
      ["Shift", "11AM-11PM"],
    ]) {
      const field = screen.getByRole("textbox", { name: label });
      expect(field).toHaveProperty("value", value);
      expect(field).toHaveProperty("readOnly", true);
    }
  });
});

describe("TripDrawer rejection", () => {
  it("asks for a reason only once Reject is chosen", () => {
    setup();
    expect(screen.queryByRole("textbox", { name: /reason/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(screen.getByRole("textbox", { name: /reason/i })).toBeDefined();
  });

  it("refuses to reject without a reason", () => {
    const { onDecided } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    save();
    expect(screen.getByText(DECISION_MESSAGES.reasonRequired)).toBeDefined();
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("refuses a whitespace-only reason", () => {
    const { onDecided } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), {
      target: { value: "    " },
    });
    save();
    expect(screen.getByText(DECISION_MESSAGES.reasonRequired)).toBeDefined();
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("rejects with a reason, without asking for a driver", async () => {
    const { onDecided } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), {
      target: { value: "No van available." },
    });
    save();

    expect(screen.queryByText(DECISION_MESSAGES.driverRequired)).toBeNull();
    await vi.waitFor(() =>
      expect(onDecided).toHaveBeenCalledWith({
        id: "REQ-1051",
        status: "Rejected",
        decidedBy: "Balandra, Ivy",
      }),
    );
    expect(patchBody()).toMatchObject({
      decision: "reject",
      rejectionReason: "No van available.",
      driver: null,
    });
  });
});

describe("TripDrawer save failures", () => {
  it("paints a server field error on the field it names", async () => {
    setup();
    mockApi(() =>
      Promise.reject(
        new ApiError(
          "VALIDATION_FAILED",
          "This decision is missing a required field.",
          422,
          { driverName: DECISION_MESSAGES.driverRequired },
        ),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await assignBoth("driver-villanueva-rey", "van-van-03");
    save();

    // The drawer's own rules passed; only the server's refusal is on screen.
    await vi.waitFor(() =>
      expect(screen.getByText(DECISION_MESSAGES.driverRequired)).toBeDefined(),
    );
  });

  it("closes on a version conflict, so the next open refetches", async () => {
    const { onClose, onDecided } = setup();
    mockApi(() =>
      Promise.reject(
        new ApiError("VERSION_CONFLICT", "Someone else updated it.", 409),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await assignBoth("driver-villanueva-rey", "van-van-03");
    save();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith("Someone else updated it.");
    // The decision did not apply, so the row must not move.
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("keeps the drawer open when the save simply failed", async () => {
    const { onClose } = setup();
    mockApi(() => Promise.reject(new Error("network down")));

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), {
      target: { value: "No van available." },
    });
    save();

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("TripDrawer editing", () => {
  it("locks the trip fields until the change box is ticked", () => {
    setup();
    const purpose = screen.getByRole("combobox", { name: "Purpose" });
    expect(purpose).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("combobox", { name: "Purpose" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  // The design gates the Driver field behind the same checkbox, so approving a
  // request would require first declaring that its trip details changed — which
  // is untrue. Assigning a driver IS the approval.
  it("leaves driver assignment editable without ticking that box", async () => {
    setup();
    await rosterLoaded();
    expect(driverSelect()).toHaveProperty("disabled", false);
  });

  it("never unlocks the requestor's own identity", () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox"));
    for (const field of ["Name", "Mobile Number", "Email"]) {
      expect(screen.getByRole("textbox", { name: field })).toHaveProperty(
        "readOnly",
        true,
      );
    }
  });

  it("sends the edited trip with no decision", async () => {
    const { onDecided, onClose } = setup();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByRole("combobox", { name: "Purpose" }), {
      target: { value: "IT-Related" },
    });
    save();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    // A field-only save is not a decision, so the row's status must not move.
    expect(onDecided).not.toHaveBeenCalled();
    expect(patchBody()).toMatchObject({
      decision: null,
      trip: expect.objectContaining({
        purpose: "IT-Related",
        dropoffPoint: "GLS Building",
        // Pickup-only: the schema forbids a standby window on this row.
        endDate: null,
        // Costing is legal on a pickup too, but nothing was typed into it.
        costPhp: null,
      }),
    });
  });

  it("edits details and saves", async () => {
    const { onDecided, onClose } = setup();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByRole("textbox", { name: "Details" }), {
      target: { value: "Corrected: offsite moved to Punta Villa." },
    });
    save();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDecided).not.toHaveBeenCalled();
    expect(patchBody()).toMatchObject({
      decision: null,
      trip: expect.objectContaining({
        details: "Corrected: offsite moved to Punta Villa.",
      }),
    });
  });

  // `applyTripEdit` refuses a blank details server-side with a generic 422 —
  // this must be caught here first, painted on the field, before the PATCH.
  it("refuses a blank details", () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByRole("textbox", { name: "Details" }), {
      target: { value: "   " },
    });
    save();

    expect(
      screen.getByText("Add details for this trip's purpose."),
    ).toBeDefined();
    expect(
      apiFetchMock.mock.calls.some(([path]) =>
        String(path).startsWith("/api/reservations/"),
      ),
    ).toBe(false);
  });

  it("offers Purpose as a select over the closed vocabulary, not free text", () => {
    // The vocabulary is enforced server-side (`isTripPurpose` in `write.ts`);
    // free text here would only earn the admin a 422 with no field to blame.
    setup();
    fireEvent.click(screen.getByRole("checkbox"));
    const purpose = screen.getByRole("combobox", { name: "Purpose" });
    expect(purpose.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "IT-Related" })).toBeDefined();
    expect(
      screen.getByRole("option", { name: "Onshore/Client Visit" }),
    ).toBeDefined();
  });

  it("preselects the request's stored purpose", () => {
    // REQ-1051's fixture purpose is "Onshore/Client Visit" — on the list.
    setup();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("combobox", { name: "Purpose" })).toHaveProperty(
      "value",
      "Onshore/Client Visit",
    );
  });

  it("keeps a stored purpose outside TRIP_PURPOSES selectable and selected", () => {
    // `reservations.purpose` has no database CHECK — only `isTripPurpose` at
    // the write path — so a row from before the vocabulary consolidation can
    // hold an off-list value. A native select whose value matches no option
    // silently falls back to the placeholder, which would read as "nothing
    // saved" for a field that has a value.
    setup(detailWith({ purpose: "Legacy Purpose Nobody Uses Anymore" }));
    fireEvent.click(screen.getByRole("checkbox"));

    const purpose = screen.getByRole("combobox", { name: "Purpose" });
    expect(
      screen.getByRole("option", {
        name: /Legacy Purpose Nobody Uses Anymore/,
      }),
    ).toBeDefined();
    expect(purpose).toHaveProperty(
      "value",
      "Legacy Purpose Nobody Uses Anymore",
    );
  });

  it("refuses a cost that is not a whole number of pesos", () => {
    setup(approvedStandby());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByRole("textbox", { name: "Additional Cost (PHP)" }), {
      target: { value: "6,400.50" },
    });
    save();

    expect(
      screen.getByText("Enter a whole number of pesos, or leave it blank."),
    ).toBeDefined();
    expect(
      apiFetchMock.mock.calls.some(([path]) =>
        String(path).startsWith("/api/reservations/"),
      ),
    ).toBe(false);
  });

  // Costing is admin bookkeeping, not mode-dependent — a rented van can back a
  // pickup trip just as it can a standby block.
  it("refuses a non-numeric cost on a pickup too", () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByRole("textbox", { name: "Additional Cost (PHP)" }), {
      target: { value: "not a number" },
    });
    save();

    expect(
      screen.getByText("Enter a whole number of pesos, or leave it blank."),
    ).toBeDefined();
    expect(
      apiFetchMock.mock.calls.some(([path]) =>
        String(path).startsWith("/api/reservations/"),
      ),
    ).toBe(false);
  });

  it("sends a vendor and cost entered on a pickup", async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByRole("textbox", { name: "Vendor" }), {
      target: { value: "Rent-A-Van Corp" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Additional Cost (PHP)" }), {
      target: { value: "3500" },
    });
    save();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patchBody()).toMatchObject({
      trip: expect.objectContaining({
        vendor: "Rent-A-Van Corp",
        costPhp: 3500,
      }),
    });
  });
});

describe("TripDrawer per-mode sections", () => {
  it("shows costing for a standby booking", () => {
    setup(approvedStandby());
    expect(screen.getByText("Additional Costing")).toBeDefined();
  });

  it("shows costing for a pickup too", () => {
    setup();
    expect(screen.getByText("Additional Costing")).toBeDefined();
  });

  it("shows a drop-off point for a pickup and an end time for a standby", () => {
    setup();
    expect(
      screen.getByRole("textbox", { name: "Drop Off Point" }),
    ).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "End Time" })).toBeNull();

    cleanup();
    setup(approvedStandby());
    expect(screen.getByRole("textbox", { name: "End Time" })).toBeDefined();
    expect(
      screen.queryByRole("textbox", { name: "Drop Off Point" }),
    ).toBeNull();
  });

  it("lists passengers as separate items with their Domain IDs", () => {
    // The design joins them into one editable string, which loses the IDs and
    // makes four people look like one value.
    setup();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("AJ29104");
  });
});

describe("TripDrawer assignment", () => {
  it("carries an already-assigned van forward", async () => {
    setup(approvedStandby());
    await fleetLoaded();
    expect(vanSelect()).toHaveProperty("value", "van-van-02");
  });

  /**
   * The whole reason both halves are rebuilt from the draft on every save.
   * `null` means "leave this side unchanged" on the wire, but
   * `validateDecisionInput` flattens it to "not assigned" — so a save that sent
   * the untouched side as null would be refused for a van the request already
   * has. If either side stops round-tripping, this fails.
   */
  it("round-trips the existing van when only the driver changes", async () => {
    setup(approvedStandby());
    await chooseDriver("driver-villanueva-rey");
    save();

    await vi.waitFor(() =>
      expect(patchBody().van).toEqual({
        source: "roster",
        vanId: "van-van-02",
      }),
    );
  });

  it("round-trips the existing driver when only the van changes", async () => {
    setup(approvedStandby());
    await chooseVan("van-van-03");
    save();

    await vi.waitFor(() =>
      expect(patchBody().driver).toEqual({
        source: "roster",
        driverId: "driver-ocampo-dennis",
      }),
    );
  });

  it("approves an already-assigned request without touching either side", async () => {
    // The same contract from the other direction: an approve-only save must
    // still send the driver and van the panel is showing.
    const { onDecided } = setup(
      detailWith({ status: "Pending", updatedBy: null }),
    );
    await fleetLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    save();

    await vi.waitFor(() => expect(onDecided).toHaveBeenCalled());
    expect(patchBody()).toMatchObject({
      driver: { source: "roster", driverId: "driver-villanueva-rey" },
      van: { source: "roster", vanId: "van-van-01" },
    });
  });

  it("blocks approval with no van and points at the van field", async () => {
    const { onDecided } = setup();
    const drivers = screen
      .getByText("Driver & Van")
      .closest("details") as HTMLDetailsElement;
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await chooseDriver("driver-villanueva-rey");
    save();

    expect(screen.getByText(DECISION_MESSAGES.vanRequired)).toBeDefined();
    // Announced, not merely coloured.
    expect(vanSelect().getAttribute("aria-describedby")).toBe(
      screen.getByText(DECISION_MESSAGES.vanRequired).id,
    );
    expect(drivers.open).toBe(true);
    expect(onDecided).not.toHaveBeenCalled();
  });

  it("reveals name and mobile inputs when the driver is a rental", async () => {
    setup();
    await chooseDriver("__others__");

    for (const label of [
      "Rental Driver's Name",
      "Rental Driver's Mobile Number",
    ]) {
      expect(screen.getByRole("textbox", { name: label })).toHaveProperty(
        "readOnly",
        false,
      );
    }
    // The roster readouts are gone: there is no roster entry behind a rental.
    expect(
      screen.queryByRole("textbox", { name: "Driver's Mobile Number" }),
    ).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Shift" })).toBeNull();
    expect(screen.getAllByText("Rental")).toHaveLength(1);
  });

  it("reveals van number, plate and car type inputs when the van is a rental", async () => {
    setup();
    await chooseVan("__others__");

    for (const label of [
      "Rental Van Number",
      "Rental Plate",
      "Rental Car Type",
    ]) {
      expect(screen.getByRole("textbox", { name: label })).toHaveProperty(
        "readOnly",
        false,
      );
    }
    expect(screen.queryByRole("textbox", { name: "Plate" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Car Type" })).toBeNull();
  });

  it("sends a rental driver and a roster van on save", async () => {
    setup();
    await chooseDriver("__others__");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Rental Driver's Name" }),
      { target: { value: "Rental Ramos" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Rental Driver's Mobile Number" }),
      { target: { value: " 9171234567 " } },
    );
    await chooseVan("van-van-03");
    save();

    await vi.waitFor(() =>
      expect(patchBody()).toMatchObject({
        driver: {
          source: "rental",
          name: "Rental Ramos",
          mobile: "9171234567",
        },
        van: { source: "roster", vanId: "van-van-03" },
      }),
    );
  });

  it("sends a rental van, with a blank van number as no number at all", async () => {
    setup();
    await chooseDriver("driver-villanueva-rey");
    await chooseVan("__others__");
    fireEvent.change(screen.getByRole("textbox", { name: "Rental Plate" }), {
      target: { value: "RENT 0007" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Rental Car Type" }), {
      target: { value: "Toyota GL" },
    });
    save();

    await vi.waitFor(() =>
      expect(patchBody().van).toEqual({
        source: "rental",
        // A vendor often gives no unit number; the plate names the vehicle.
        vanNumber: null,
        plate: "RENT 0007",
        carType: "Toyota GL",
      }),
    );
  });

  it("refuses a rental whose required fields are blank", async () => {
    setup();
    await chooseDriver("__others__");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Rental Driver's Name" }),
      { target: { value: "Rental Ramos" } },
    );
    save();

    // `wire.ts` puts min(1) on every rental field, so a blank one comes back as
    // a parse error with nothing to point at unless it is caught here.
    expect(screen.getByText("Required for a rental.")).toBeDefined();
    expect(
      apiFetchMock.mock.calls.some(([path]) =>
        String(path).startsWith("/api/reservations/"),
      ),
    ).toBe(false);
  });

  it("seeds both blocks from a stored rental assignment", async () => {
    setup(
      detailWith({
        driver: "Rental Ramos",
        driverId: null,
        driverSource: "rental",
        vanLabel: "RENT 0007",
        vanSource: "rental",
      }),
    );
    await fleetLoaded();

    expect(driverSelect()).toHaveProperty("value", "__others__");
    expect(vanSelect()).toHaveProperty("value", "__others__");
    expect(
      screen.getByRole("textbox", { name: "Rental Driver's Name" }),
    ).toHaveProperty("value", "Rental Ramos");
    expect(
      screen.getByRole("textbox", { name: "Rental Plate" }),
    ).toHaveProperty("value", "RENT 0007");
    // `vanLabel` collapses three sources into one string, so a rental's label
    // reads back as its plate with no van number — see the fixture's comment.
    expect(
      screen.getByRole("textbox", { name: "Rental Van Number" }),
    ).toHaveProperty("value", "");
    expect(screen.getAllByText("Rental")).toHaveLength(2);
  });

  it("never shows a rental driver's mobile as a roster readout", () => {
    // It was rendered under "From the driver's roster entry.", which a rental
    // does not have. Unreachable until this drawer could select a rental.
    setup(
      detailWith({
        driver: "Rental Ramos",
        driverId: null,
        driverSource: "rental",
      }),
    );

    expect(
      screen.queryByRole("textbox", { name: "Driver's Mobile Number" }),
    ).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Rental Driver's Mobile Number" }),
    ).toHaveProperty("value", "09171234567");
  });

  it("keeps a retired van selectable only where it is already assigned", async () => {
    setup(detailWith({ vanLabel: "VAN-09", vanSource: "roster" }));
    await fleetLoaded();
    expect(screen.getByRole("option", { name: /VAN-009/ })).toBeDefined();

    cleanup();
    setup();
    await fleetLoaded();
    expect(screen.queryByRole("option", { name: /VAN-009/ })).toBeNull();
  });

  it("offers manual entry on both selects", async () => {
    setup();
    await fleetLoaded();
    expect(screen.getAllByRole("option", { name: "Others…" })).toHaveLength(2);
  });

  it("names a fleet van by its number and plate, with no driver suffix on the driver", async () => {
    setup();
    await fleetLoaded();
    expect(
      screen.getByRole("option", { name: "VAN-003 · NHU 8003" }),
    ).toBeDefined();
    // A driver no longer owns a van, so the label is the name alone.
    expect(
      screen.getByRole("option", { name: "Villanueva, Rey" }),
    ).toBeDefined();
  });

  it("shows the selected van's plate and car type as readouts", async () => {
    setup();
    await chooseVan("van-van-03");

    for (const [label, value] of [
      ["Plate", "NHU 8003"],
      ["Car Type", "Urvan"],
    ]) {
      const field = screen.getByRole("textbox", { name: label });
      expect(field).toHaveProperty("value", value);
      // `reservations` stores only the van's id, so a typed copy here would be
      // discarded on save.
      expect(field).toHaveProperty("readOnly", true);
    }
  });

  it("reports the vans fetch failing without blocking the rest of the panel", async () => {
    apiFetchMock.mockImplementation((path: string) =>
      path === "/api/vans"
        ? Promise.reject(new Error("fleet down"))
        : Promise.resolve(ROSTER),
    );
    setup();

    expect(
      await screen.findByText(
        /Couldn't load the van fleet\. Close and reopen this request/,
      ),
    ).toBeDefined();
  });
});

describe("TripDrawer reassign mode", () => {
  const reassigning = () => setup(approvedStandby(), { mode: "reassign" });

  it("hides the decision buttons", () => {
    reassigning();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("keeps the trip fields read-only with no unlock", () => {
    reassigning();
    expect(
      screen.queryByRole("checkbox", { name: /trip details changed/i }),
    ).toBeNull();
    expect(screen.getByRole("combobox", { name: "Purpose" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("names the consequence on the save button", () => {
    reassigning();
    expect(
      screen.getByRole("button", { name: "Reassign & Save" }),
    ).toBeDefined();
  });

  // Otherwise the button sends a request the server treats as a no-op and the
  // admin gets a success toast for nothing.
  it("refuses a save that moved neither side", () => {
    reassigning();
    save();
    expect(screen.getByText(DECISION_MESSAGES.reassignNothing)).toBeDefined();
    expect(apiFetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/reservations/"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  // A DIFFERENT driver than REQ-1038 already carries — picking the assigned one
  // is the no-op the guard above refuses.
  it("sends decision: null and trip: null", async () => {
    reassigning();
    await chooseDriver("driver-villanueva-rey");
    save();

    await vi.waitFor(() => {
      const body = patchBody();
      expect(body.decision).toBeNull();
      expect(body.trip).toBeNull();
      expect(body.driver).toEqual({
        source: "roster",
        driverId: "driver-villanueva-rey",
      });
    });
  });
});
