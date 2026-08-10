// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReservationRow } from "@/modules/reservations/types";

const apiFetchMock = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/api-fetcher", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  ApiError: class MockApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));

const { ManageView } = await import(
  "@/components/requestor/manage/manage-view"
);
const { ApiError } = await import("@/lib/api-fetcher");
const { toast } = await import("sonner");

const TODAY = "2026-08-05";

function pendingRow(): ReservationRow {
  return {
    id: "VR-2026-000412",
    submittedAt: "2026-08-03T01:12:00Z",
    startDate: "2026-08-08",
    startTime: "06:30",
    endTime: null,
    requestor: "Jimera, Arielle",
    site: "Manila",
    from: "GLS Tower lobby",
    to: "AGT Building",
    mode: "pickup",
    purpose: "Onshore/Client Visit",
    details: "Test fixture trip.",
    status: "Pending",
    updatedBy: null,
    updatedAt: null,
    driver: null,
    driverId: null,
    driverSource: null,
    vanLabel: null,
    vanSource: null,
    vanPlate: null,
    remarks: null,
  };
}

function approvedRow(): ReservationRow {
  return {
    ...pendingRow(),
    status: "Approved",
    driver: "Villanueva, Ruel",
    driverId: "driver-1",
    driverSource: "roster",
    vanLabel: "VAN-01",
    vanSource: "roster",
    vanPlate: "NHU 8001",
    updatedBy: "Dizon, Marco",
  };
}

function rejectedRow(): ReservationRow {
  return { ...pendingRow(), status: "Rejected", updatedBy: "Dizon, Marco" };
}

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
  apiFetchMock.mockResolvedValue(null);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(cleanup);

/** Opens the row menu and starts a cancellation. */
function openCancelDialog() {
  render(<ManageView initialRows={[pendingRow()]} today={TODAY} />);
  fireEvent.click(screen.getByRole("button", { name: /actions|menu|⋯|more/i }));
  fireEvent.click(screen.getByRole("menuitem", { name: /cancel/i }));
}

const confirm = () =>
  fireEvent.click(screen.getByRole("button", { name: /cancel booking/i }));

const statusCell = () => screen.getByText(/^(Pending|Cancelled)$/);

describe("ManageView cancellation", () => {
  it("posts to the cancel route, not a DELETE on the reservation", async () => {
    openCancelDialog();
    confirm();

    await vi.waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/reservations/VR-2026-000412/cancel",
        { method: "POST" },
      ),
    );
  });

  it("moves the row to Cancelled only after the write lands", async () => {
    let settle: (() => void) | undefined;
    apiFetchMock.mockReturnValue(
      new Promise<null>((resolve) => {
        settle = () => resolve(null);
      }),
    );

    openCancelDialog();
    confirm();

    // Still in flight: the table must not claim a cancellation yet.
    expect(statusCell().textContent).toBe("Pending");

    settle?.();
    await vi.waitFor(() => expect(statusCell().textContent).toBe("Cancelled"));
    expect(toast.success).toHaveBeenCalledWith("VR-2026-000412 cancelled.");
  });

  it("leaves the row alone and says why when the server refuses", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError(
        "INVALID_TRANSITION",
        "Only a request still awaiting approval can be changed.",
        409,
      ),
    );

    openCancelDialog();
    confirm();

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Only a request still awaiting approval can be changed.",
      ),
    );
    expect(statusCell().textContent).toBe("Pending");
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("ManageView cancelling a decided row", () => {
  it("offers Cancel for an approved row and warns the assignment is freed", () => {
    render(<ManageView initialRows={[approvedRow()]} today={TODAY} />);
    fireEvent.click(
      screen.getByRole("button", { name: /actions|menu|⋯|more/i }),
    );

    const cancelItem = screen.getByRole("menuitem", {
      name: /cancel/i,
    }) as HTMLButtonElement;
    expect(cancelItem.disabled).toBe(false);
    fireEvent.click(cancelItem);

    expect(
      screen.getByText(/driver and van are assigned and will be freed/i),
    ).not.toBeNull();
    expect(screen.getByText(/cannot be undone/i)).not.toBeNull();
  });

  it("disables Cancel for a rejected row", () => {
    render(<ManageView initialRows={[rejectedRow()]} today={TODAY} />);
    fireEvent.click(
      screen.getByRole("button", { name: /actions|menu|⋯|more/i }),
    );

    const cancelItem = screen.getByRole("menuitem", {
      name: /cancel/i,
    }) as HTMLButtonElement;
    expect(cancelItem.disabled).toBe(true);
  });
});
