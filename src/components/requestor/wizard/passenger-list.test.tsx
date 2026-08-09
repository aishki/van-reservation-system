// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PassengerDraft, TripErrors } from "@/modules/reservations/draft";
import { blankPassenger } from "@/modules/reservations/draft";

const apiFetchMock = vi.fn();

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

const { PassengerList } = await import(
  "@/components/requestor/wizard/passenger-list"
);
const { ApiError } = await import("@/lib/api-fetcher");

const LOOKUP_DEBOUNCE_MS = 350;

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function blankErrors(count: number): TripErrors {
  return {
    passengerRows: Array.from({ length: count }, () => ({
      domainId: false,
      name: false,
    })),
    missing: {},
  };
}

/**
 * Owns a `PassengerDraft[]` and wires `onChange`/`onAdd`/`onRemove` back into
 * it — the same shape `step-trips.tsx` uses, so the row's derived-name effect
 * (which round-trips through the parent's state) is exercised for real.
 */
function Harness() {
  const [passengers, setPassengers] = useState<PassengerDraft[]>([
    blankPassenger(),
  ]);

  return (
    <Providers>
      <PassengerList
        passengers={passengers}
        errors={blankErrors(passengers.length)}
        tripLabel="Trip 1"
        onChange={(index, patch) =>
          setPassengers((prev) =>
            prev.map((p, i) => (i === index ? { ...p, ...patch } : p)),
          )
        }
        onAdd={() => setPassengers((prev) => [...prev, blankPassenger()])}
        onRemove={(index) =>
          setPassengers((prev) => prev.filter((_, i) => i !== index))
        }
      />
    </Providers>
  );
}

function domainIdInput() {
  return screen.getByLabelText(/Domain ID/) as HTMLInputElement;
}

function nameInput() {
  return screen.getByLabelText(/Passenger Name/) as HTMLInputElement;
}

/**
 * Types a Domain ID and waits out the real debounce so the lookup fires.
 * Real timers rather than faked ones: TanStack Query schedules its own
 * fetch/retry bookkeeping on the timer queue, and racing that against fake
 * timers is more trouble than a 350ms real wait in a handful of tests.
 */
async function typeDomainId(value: string) {
  fireEvent.change(domainIdInput(), { target: { value } });
  await new Promise((resolve) => setTimeout(resolve, LOOKUP_DEBOUNCE_MS + 20));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PassengerList / PassengerRow", () => {
  it("fills the name from a resolved 7-char Domain ID and locks the field", async () => {
    apiFetchMock.mockResolvedValueOnce({ found: true, name: "Maria Santos" });
    render(<Harness />);

    await typeDomainId("CD67890");

    await screen.findByDisplayValue("Maria Santos");
    expect(nameInput().readOnly).toBe(true);
  });

  it("shows the not-registered message and leaves the name empty for an unknown id", async () => {
    apiFetchMock.mockResolvedValueOnce({ found: false });
    render(<Harness />);

    await typeDomainId("ZZ99999");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "This Domain ID isn't registered.",
    );
    expect(nameInput().value).toBe("");
  });

  it("clears the resolved name immediately when the Domain ID is edited again", async () => {
    apiFetchMock.mockResolvedValueOnce({ found: true, name: "Maria Santos" });
    render(<Harness />);

    await typeDomainId("CD67890");
    await screen.findByDisplayValue("Maria Santos");

    // Same patch that changes the id also clears the name — no debounce wait.
    fireEvent.change(domainIdInput(), { target: { value: "CD6789" } });
    expect(nameInput().value).toBe("");
  });

  it("renders the ApiError's message for a rejected lookup", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(
        "SERVICE_UNAVAILABLE",
        "Couldn't check that Domain ID right now. Try again.",
        503,
      ),
    );
    render(<Harness />);

    await typeDomainId("CD67890");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't check that Domain ID right now. Try again.",
    );
  });

  it("falls back to the generic message for a non-envelope (UNKNOWN) failure", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(
        "UNKNOWN",
        "Request to /api/associates/lookup failed with status 502",
        502,
      ),
    );
    render(<Harness />);

    await typeDomainId("CD67890");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't check that Domain ID right now.",
    );
  });
});
