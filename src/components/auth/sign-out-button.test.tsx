// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const clear = vi.fn();
const apiFetchMock = vi.fn();
const toastError = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear }),
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

vi.mock("sonner", () => ({
  toast: { error: toastError },
}));

const { SignOutButton } = await import("@/components/auth/sign-out-button");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SignOutButton", () => {
  it("requests /api/auth/logout when clicked", async () => {
    apiFetchMock.mockResolvedValue(undefined);
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/api/auth/logout", {
        method: "POST",
      }),
    );
  });

  it("clears the query cache and navigates only after the logout request resolves", async () => {
    let resolveLogout: () => void = () => {};
    apiFetchMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = resolve;
        }),
    );
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(clear).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    resolveLogout();
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith("/login");

    const clearOrder = clear.mock.invocationCallOrder[0];
    const replaceOrder = replace.mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(replaceOrder);
  });

  it("neither clears the cache nor navigates when the logout request rejects, and reports the failure", async () => {
    apiFetchMock.mockRejectedValue(new Error("network down"));
    render(<SignOutButton />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(clear).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
