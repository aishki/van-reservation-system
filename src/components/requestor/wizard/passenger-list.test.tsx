// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blankPassenger,
  type PassengerDraft,
  type TripErrors,
} from "@/modules/reservations/draft";
import type { FieldHistory } from "@/modules/reservations/types";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api-fetcher", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

// Dynamic, post-mock import: `PassengerList` pulls in `useFieldHistory`,
// which calls `apiFetch` at module scope's call time (inside the hook, on
// mount) — a static import would resolve before `vi.mock` above is wired up
// in every environment this suite runs in.
const { PassengerList } = await import(
  "@/components/requestor/wizard/passenger-list"
);

const NO_HISTORY: FieldHistory = {
  pickupPoint: [],
  dropoffPoint: [],
  mobile: [],
  passengerName: [],
  passengerEmail: [],
};

function blankErrors(count: number): TripErrors {
  return {
    passengerRows: Array.from({ length: count }, () => ({
      name: false,
      email: false,
    })),
    missing: {},
  };
}

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Owns a `PassengerDraft[]` and wires `onChange`/`onAdd`/`onRemove` back into
 * it — the same shape `step-trips.tsx` uses.
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

function renderWithHistory(node: ReactElement, history = NO_HISTORY) {
  apiFetchMock.mockResolvedValue(history);
  return render(<Providers>{node}</Providers>);
}

function nameInputs() {
  return screen.getAllByLabelText(/Passenger Name/) as HTMLInputElement[];
}

function emailInputs() {
  return screen.getAllByLabelText(/Passenger Email/) as HTMLInputElement[];
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PassengerList / PassengerRow", () => {
  it("takes both fields as plain manual entry", async () => {
    apiFetchMock.mockResolvedValue(NO_HISTORY);
    render(<Harness />);
    await screen.findByPlaceholderText("Juan Dela Cruz");

    fireEvent.change(nameInputs()[0], {
      target: { value: "Juan Dela Cruz" },
    });
    fireEvent.change(emailInputs()[0], {
      target: { value: "juan.delacruz@carelon.com" },
    });

    expect(nameInputs()[0].value).toBe("Juan Dela Cruz");
    expect(emailInputs()[0].value).toBe("juan.delacruz@carelon.com");
    expect(nameInputs()[0].readOnly).toBe(false);
    expect(emailInputs()[0].readOnly).toBe(false);
  });

  it("leaves the email blank without complaint — many passengers have none", async () => {
    apiFetchMock.mockResolvedValue(NO_HISTORY);
    render(<Harness />);
    await screen.findByPlaceholderText("Juan Dela Cruz");

    fireEvent.change(nameInputs()[0], { target: { value: "Juan Dela Cruz" } });

    expect(emailInputs()[0].value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adds and removes rows via the stepper", async () => {
    apiFetchMock.mockResolvedValue(NO_HISTORY);
    render(<Harness />);
    await screen.findByPlaceholderText("Juan Dela Cruz");

    fireEvent.click(screen.getByLabelText("Add one passenger"));
    expect(nameInputs()).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Remove one passenger"));
    expect(nameInputs()).toHaveLength(1);
  });

  it("disables removal at exactly one passenger", async () => {
    apiFetchMock.mockResolvedValue(NO_HISTORY);
    render(<Harness />);
    await screen.findByPlaceholderText("Juan Dela Cruz");

    const remove = screen.getByLabelText(
      "Remove one passenger",
    ) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
  });

  it("shows the block-level error message when passed one", () => {
    renderWithHistory(
      <PassengerList
        passengers={[blankPassenger()]}
        errors={{
          passengerRows: [{ name: true, email: false }],
          missing: {},
          passengers: "Every passenger needs a name.",
        }}
        tripLabel="Trip 1"
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Every passenger needs a name.",
    );
  });

  it("marks only the row an error flag points at", () => {
    renderWithHistory(
      <PassengerList
        passengers={[blankPassenger(), blankPassenger()]}
        errors={{
          passengerRows: [
            { name: false, email: false },
            { name: false, email: true },
          ],
          missing: {},
        }}
        tripLabel="Trip 1"
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(emailInputs()[0].getAttribute("aria-invalid")).toBe("false");
    expect(emailInputs()[1].getAttribute("aria-invalid")).toBe("true");
  });

  it("suggests past names on focus and fills the row on pick", async () => {
    const onChange = vi.fn();
    renderWithHistory(
      <PassengerList
        passengers={[blankPassenger()]}
        errors={blankErrors(1)}
        tripLabel="Trip 1"
        onChange={onChange}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
      { ...NO_HISTORY, passengerName: ["Maria Reyes", "Juan Cruz"] },
    );
    await screen.findByPlaceholderText("Juan Dela Cruz");

    // Retried, not a single focus + findByRole: the panel only opens once
    // `useFieldHistory`'s query has actually resolved, which lands a render
    // or two after this mount — a focus fired before that sees no suggestions
    // to open for. `waitFor` re-fires it each tick until that render has run.
    await waitFor(() => {
      fireEvent.focus(nameInputs()[0]);
      expect(screen.getByRole("option", { name: "Maria Reyes" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("option", { name: "Maria Reyes" }));

    expect(onChange).toHaveBeenCalledWith(0, { name: "Maria Reyes" });
    // Picking closes the panel and returns focus to the input, rather than
    // leaving a stale list open over a value the click just replaced.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(nameInputs()[0]);
  });

  it("filters suggestions to ones matching what's typed", async () => {
    renderWithHistory(
      <PassengerList
        passengers={[{ name: "Mar", email: "" }]}
        errors={blankErrors(1)}
        tripLabel="Trip 1"
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
      { ...NO_HISTORY, passengerName: ["Maria Reyes", "Juan Cruz"] },
    );
    await screen.findByPlaceholderText("Juan Dela Cruz");

    await waitFor(() => {
      fireEvent.focus(nameInputs()[0]);
      expect(screen.getByRole("option", { name: "Maria Reyes" })).toBeTruthy();
    });

    expect(screen.queryByRole("option", { name: "Juan Cruz" })).toBeNull();
  });
});
