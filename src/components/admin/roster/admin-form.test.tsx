// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// `ApiError` is mocked alongside `apiFetch`, matching `trip-drawer.test.tsx` —
// AdminForm attaches a server field error via `instanceof ApiError`, so a mock
// that omitted it would make that check throw rather than fall through.
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

const { AdminForm } = await import("@/components/admin/roster/admin-form");
const { ApiError } = await import("@/lib/api-fetcher");
const { adminCreateSchema, adminPatchSchema } = await import(
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
});

function renderForm(overrides = {}) {
  render(<AdminForm row={null} onDone={vi.fn()} {...overrides} />);
}

describe("AdminForm", () => {
  it("refuses a submission with neither email nor Domain ID", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Juan Cruz" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    // Caught in the form so the user sees a message naming both fields,
    // rather than admin_whitelist_identity_check surfacing as a bare 422.
    expect(
      await screen.findByText(/email address or a Domain ID/i),
    ).toBeDefined();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("attaches a duplicate-email error to the Email field", async () => {
    apiFetchMock.mockRejectedValue(
      new ApiError(
        "VALIDATION_FAILED",
        "Another admin already uses that email address.",
        422,
        { field: "email" },
      ),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Juan Cruz" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "taken@carelon.com" },
    });
    // Site is required like Name — filled here so the only thing standing
    // between this submission and the network is the server's own refusal.
    fireEvent.change(screen.getByLabelText("Site"), {
      target: { value: "manila" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(await screen.findByText(/already uses that email/i)).toBeDefined();
  });

  it("offers the whitelist-manager toggle", () => {
    renderForm();
    expect(screen.getByLabelText(/Manages the whitelist/i)).toBeDefined();
  });
});

/** The body the form actually sent, parsed back off the `apiFetch` call. */
function sentPayload(): unknown {
  const init = apiFetchMock.mock.calls[0]?.[1] as { body: string } | undefined;
  if (init === undefined) throw new Error("apiFetch was never called");
  return JSON.parse(init.body);
}

/**
 * The form→schema boundary, crossed for real.
 *
 * The cases above prove only that `apiFetch` was called; `wire.test.ts` proves
 * only that a HAND-WRITTEN object parses. Neither notices a form key the schema
 * does not know — and the PATCH sends its FULL payload against a `.strict()`
 * schema, so one extra or misnamed key makes every edit a 422.
 */
describe("AdminForm payload against the real schema", () => {
  const ROW = {
    id: "a1",
    fullName: "Ivy Balandra",
    email: "ivy.balandra@carelon.com",
    domainId: "AL95338",
    site: "iloilo" as const,
    notify: true,
    active: true,
    superAdmin: false,
  };

  beforeEach(() => {
    apiFetchMock.mockResolvedValue(undefined);
  });

  it("a create parses as adminCreateSchema", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Juan Cruz" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "juan.cruz@carelon.com" },
    });
    fireEvent.change(screen.getByLabelText("Site"), {
      target: { value: "all" },
    });
    fireEvent.click(screen.getByLabelText(/Manages the whitelist/i));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(adminCreateSchema.safeParse(sentPayload())).toMatchObject({
      success: true,
    });
  });

  // Domain ID only, no email: the identity rule admits either, and the null
  // the form sends for the empty box has to survive the schema.
  it("a create identified by Domain ID alone parses", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Juan Cruz" },
    });
    fireEvent.change(screen.getByLabelText("Domain ID"), {
      target: { value: "AB12345" },
    });
    fireEvent.change(screen.getByLabelText("Site"), {
      target: { value: "manila" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(adminCreateSchema.safeParse(sentPayload())).toMatchObject({
      success: true,
    });
  });

  it("an edit parses as adminPatchSchema, which rejects unknown keys", () => {
    renderForm({ row: ROW });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Ivy Balandra-Cruz" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(adminPatchSchema.safeParse(sentPayload())).toMatchObject({
      success: true,
    });
  });
});
