// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PassengerList } from "@/components/requestor/wizard/passenger-list";
import {
  blankPassenger,
  type PassengerDraft,
  type TripErrors,
} from "@/modules/reservations/draft";

function blankErrors(count: number): TripErrors {
  return {
    passengerRows: Array.from({ length: count }, () => ({
      name: false,
      email: false,
    })),
    missing: {},
  };
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
  );
}

function nameInputs() {
  return screen.getAllByLabelText(/Passenger Name/) as HTMLInputElement[];
}

function emailInputs() {
  return screen.getAllByLabelText(/Passenger Email/) as HTMLInputElement[];
}

afterEach(() => {
  cleanup();
});

describe("PassengerList / PassengerRow", () => {
  it("takes both fields as plain manual entry", () => {
    render(<Harness />);

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

  it("leaves the email blank without complaint — many passengers have none", () => {
    render(<Harness />);

    fireEvent.change(nameInputs()[0], { target: { value: "Juan Dela Cruz" } });

    expect(emailInputs()[0].value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adds and removes rows via the stepper", () => {
    render(<Harness />);

    fireEvent.click(screen.getByLabelText("Add one passenger"));
    expect(nameInputs()).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Remove one passenger"));
    expect(nameInputs()).toHaveLength(1);
  });

  it("disables removal at exactly one passenger", () => {
    render(<Harness />);

    const remove = screen.getByLabelText(
      "Remove one passenger",
    ) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
  });

  it("shows the block-level error message when passed one", () => {
    render(
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
    render(
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
});
