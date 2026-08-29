// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeQueryClient } from "@/lib/query-client";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api-fetcher", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const { DeactivateDialog } = await import(
  "@/components/admin/roster/deactivate-dialog"
);

afterEach(cleanup);

beforeEach(() => {
  // jsdom implements neither, and the dialog opens as a real modal.
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  apiFetchMock.mockReset();
});

function renderDialog(overrides = {}) {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <DeactivateDialog
        target="driver"
        id="d1"
        name="Ronald Japitana"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

describe("DeactivateDialog", () => {
  it("lists the affected trips so the consequence is visible before confirming", async () => {
    apiFetchMock.mockResolvedValue([
      {
        reference: "VR-2026-000159",
        startDate: "2026-09-10",
        requestor: "Juan Cruz",
      },
    ]);
    renderDialog();
    expect(await screen.findByText("VR-2026-000159")).toBeDefined();
  });

  it("says the trips KEEP their assignee, because deactivating does not unassign", async () => {
    apiFetchMock.mockResolvedValue([
      {
        reference: "VR-2026-000159",
        startDate: "2026-09-10",
        requestor: "Juan Cruz",
      },
    ]);
    renderDialog();
    await screen.findByText("VR-2026-000159");
    expect(screen.getByText(/keep their assigned/i)).toBeDefined();
  });

  it("does not confirm when cancelled", async () => {
    apiFetchMock.mockResolvedValue([]);
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    fireEvent.click(await screen.findByRole("button", { name: /Cancel/ }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms without waiting for the list when there are no affected trips", async () => {
    apiFetchMock.mockResolvedValue([]);
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    fireEvent.click(await screen.findByRole("button", { name: /Deactivate/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("still allows deactivation WITH affected trips — it warns, it does not block", async () => {
    // Blocking would strand the operator at the moment deactivation is most
    // needed: somebody resigning mid-schedule.
    apiFetchMock.mockResolvedValue([
      {
        reference: "VR-2026-000159",
        startDate: "2026-09-10",
        requestor: "Juan Cruz",
      },
    ]);
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    await screen.findByText("VR-2026-000159");
    fireEvent.click(screen.getByRole("button", { name: /Deactivate/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("requests the target-specific affected endpoint", async () => {
    apiFetchMock.mockResolvedValue([]);
    renderDialog({ target: "van", id: "v1", name: "VAN-001" });
    await screen.findByText(/no upcoming trips/i);
    expect(apiFetchMock).toHaveBeenCalledWith("/api/vans/v1/affected");
  });
});
