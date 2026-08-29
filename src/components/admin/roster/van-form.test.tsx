// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// `ApiError` is mocked alongside `apiFetch`, matching `admin-form.test.tsx` —
// the form attaches a server field error via `instanceof ApiError`.
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

const { VanForm } = await import("@/components/admin/roster/van-form");
const { vanCreateSchema, vanPatchSchema } = await import(
  "@/modules/roster/wire"
);

afterEach(cleanup);

beforeEach(() => {
  // jsdom implements neither, and the form opens as a real modal.
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue(undefined);
});

const ROW = {
  id: "v1",
  vanNumber: "VAN-001",
  plate: "FAR 8931",
  carType: "Toyota GL",
  site: "Iloilo" as const,
  active: true,
};

/** The body the form actually sent, parsed back off the `apiFetch` call. */
function sentPayload(): unknown {
  const init = apiFetchMock.mock.calls[0]?.[1] as { body: string } | undefined;
  if (init === undefined) throw new Error("apiFetch was never called");
  return JSON.parse(init.body);
}

/** The form→schema boundary, crossed for real — see `driver-form.test.tsx`. */
describe("VanForm payload against the real schema", () => {
  it("a create parses as vanCreateSchema", () => {
    render(<VanForm row={null} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Van number"), {
      target: { value: "VAN-005" },
    });
    fireEvent.change(screen.getByLabelText("Plate"), {
      target: { value: "  ABC 1234  " },
    });
    fireEvent.change(screen.getByLabelText("Car type"), {
      target: { value: "Toyota GL" },
    });
    fireEvent.change(screen.getByLabelText("Site"), {
      target: { value: "Manila" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(vanCreateSchema.safeParse(sentPayload())).toMatchObject({
      success: true,
    });
  });

  it("an edit parses as vanPatchSchema, which rejects unknown keys", () => {
    render(<VanForm row={ROW} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Plate"), {
      target: { value: "FAR 9999" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(vanPatchSchema.safeParse(sentPayload())).toMatchObject({
      success: true,
    });
  });
});
