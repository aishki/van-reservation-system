// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api-fetcher", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const { useFieldHistory } = await import("@/hooks/use-field-history");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useFieldHistory", () => {
  it("returns an all-empty snapshot before the fetch resolves", () => {
    apiFetchMock.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useFieldHistory(), { wrapper });

    expect(result.current).toEqual({
      pickupPoint: [],
      dropoffPoint: [],
      passengerName: [],
      passengerEmail: [],
      mobile: [],
    });
  });

  it("returns the fetched history once it resolves", async () => {
    const history = {
      pickupPoint: ["GLS Tower lobby"],
      dropoffPoint: [],
      passengerName: ["Dela Cruz, Juan"],
      passengerEmail: [],
      mobile: ["09171234567"],
    };
    apiFetchMock.mockResolvedValue(history);

    const { result } = renderHook(() => useFieldHistory(), { wrapper });

    await waitFor(() => expect(result.current).toEqual(history));
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/reservations/field-history",
    );
  });
});
