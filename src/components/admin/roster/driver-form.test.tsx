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

const { DriverForm } = await import("@/components/admin/roster/driver-form");
const { driverCreateSchema, driverPatchSchema } = await import(
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
  id: "d1",
  name: "Ronald Japitana",
  mobile: "09171234567",
  site: "Iloilo",
  shift: null,
  active: true,
};

/** The body the form actually sent, parsed back off the `apiFetch` call. */
function sentPayload(): unknown {
  const init = apiFetchMock.mock.calls[0]?.[1] as { body: string } | undefined;
  if (init === undefined) throw new Error("apiFetch was never called");
  return JSON.parse(init.body);
}

/**
 * The form→schema boundary, crossed for real.
 *
 * Mocking `apiFetch` proves only that the form called it with the object the
 * test expected; `wire.test.ts` proves only that a HAND-WRITTEN object parses.
 * Neither notices a form key the schema does not know — and every PATCH here
 * sends its FULL payload against a `.strict()` schema, so one extra or
 * misnamed key makes every edit a 422. So: take what the form built and run it
 * through the real schema.
 */
describe("DriverForm payload against the real schema", () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  Ronald Japitana  " },
    });
    fireEvent.change(screen.getByLabelText("Mobile"), {
      target: { value: "09171234567" },
    });
    fireEvent.change(screen.getByLabelText("Site"), {
      target: { value: "Iloilo" },
    });
  };

  it("a create parses as driverCreateSchema", () => {
    render(<DriverForm row={null} onDone={vi.fn()} />);
    fill();
    fireEvent.change(screen.getByLabelText("Shift"), {
      target: { value: "11AM-11PM" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(driverCreateSchema.safeParse(sentPayload())).toMatchObject({
      success: true,
    });
  });

  // Blank shift means "no shift on file" — `text` would refuse "".
  it("a create with no shift parses, as null rather than an empty string", () => {
    render(<DriverForm row={null} onDone={vi.fn()} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    const parsed = driverCreateSchema.safeParse(sentPayload());
    expect(parsed.success).toBe(true);
    expect(parsed.data?.shift).toBeNull();
  });

  it("an edit parses as driverPatchSchema, which rejects unknown keys", () => {
    render(<DriverForm row={ROW} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Mobile"), {
      target: { value: "09172222222" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(driverPatchSchema.safeParse(sentPayload())).toMatchObject({
      success: true,
    });
  });
});
