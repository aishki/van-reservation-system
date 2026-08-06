// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DomainIdInput } from "@/components/auth/domain-id-input";

afterEach(() => {
  cleanup();
});

// DomainIdInput is fully controlled (value/onChange) — tests drive it
// through a small stateful harness rather than asserting on isolated props,
// the same way a consumer (login-form.tsx) would.
function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <DomainIdInput
      id="domainId"
      value={value}
      onChange={setValue}
      accent={{
        fieldLabel: "text-brand",
        focusRing: "focus-visible:border-brand",
        fieldBorder: "border-gray-4",
        fieldBorderFilled: "border-brand",
      }}
    />
  );
}

function getBoxes() {
  return screen.getAllByLabelText(
    /Domain ID character \d of 7/,
  ) as HTMLInputElement[];
}

describe("DomainIdInput", () => {
  it("exposes an accessible group name and seven individually labelled boxes", () => {
    render(<Harness />);
    // getByRole throws if no match (or more than one) is found — the group
    // must have exactly one accessible name, "Domain ID".
    const group = screen.getByRole("group", { name: "Domain ID" });
    expect(group).not.toBeNull();

    // Querying each box by its exact expected label proves per-box labelling
    // directly, rather than re-checking a separately-computed accessible name.
    for (let i = 0; i < 7; i++) {
      const box = screen.getByLabelText(`Domain ID character ${i + 1} of 7`);
      expect(box).not.toBeNull();
    }
    expect(getBoxes()).toHaveLength(7);
  });

  it("advances focus to the next box after typing a character", () => {
    render(<Harness />);
    const boxes = getBoxes();
    fireEvent.change(boxes[0], { target: { value: "A" } });
    expect(document.activeElement).toBe(boxes[1]);
  });

  it("does not advance focus past the seventh box", () => {
    render(<Harness />);
    const boxes = getBoxes();
    boxes[6].focus();
    fireEvent.change(boxes[6], { target: { value: "7" } });
    expect(document.activeElement).toBe(boxes[6]);
  });

  it("moves focus back and clears the previous box on backspace in an empty box", () => {
    render(<Harness />);
    const boxes = getBoxes();
    fireEvent.change(boxes[0], { target: { value: "A" } });
    // Focus is now on boxes[1], which is empty.
    fireEvent.keyDown(boxes[1], { key: "Backspace" });
    expect(document.activeElement).toBe(boxes[0]);
    expect(boxes[0].value).toBe("");
  });

  it("does nothing on backspace in an empty first box (no box before it)", () => {
    render(<Harness />);
    const boxes = getBoxes();
    boxes[0].focus();
    fireEvent.keyDown(boxes[0], { key: "Backspace" });
    expect(document.activeElement).toBe(boxes[0]);
  });

  it("fills all seven boxes when a full 7-character string is pasted", () => {
    render(<Harness />);
    const boxes = getBoxes();
    fireEvent.paste(boxes[0], {
      clipboardData: { getData: () => "AB12345" },
    });
    for (const [i, char] of "AB12345".split("").entries()) {
      expect(boxes[i].value).toBe(char);
    }
  });

  it("composes the seven boxes into a single value passed to onChange", () => {
    render(<Harness />);
    const boxes = getBoxes();
    for (const [i, char] of "AB12345".split("").entries()) {
      fireEvent.change(boxes[i], { target: { value: char } });
    }
    // The composed value round-trips through the controlled `value` prop —
    // reading it back off each box only produces "AB12345" if the parent's
    // state (driven by onChange) reflects the full seven-character string.
    expect(boxes.map((box) => box.value).join("")).toBe("AB12345");
  });

  // The boxes carry an `uppercase` class, so a lower-case entry looks correct
  // on screen either way. These assert the composed VALUE — what the login and
  // verify-domain calls actually send, and what the directory rejects if it
  // arrives lower case.
  it("upper-cases typed characters in the value, not only in the display", () => {
    render(<Harness />);
    const boxes = getBoxes();
    for (const [i, char] of "ab12345".split("").entries()) {
      fireEvent.change(boxes[i], { target: { value: char } });
    }
    expect(boxes.map((box) => box.value).join("")).toBe("AB12345");
  });

  it("upper-cases and trims a pasted id", () => {
    render(<Harness />);
    const boxes = getBoxes();
    fireEvent.paste(boxes[0], {
      clipboardData: { getData: () => " ab12345 " },
    });
    expect(boxes.map((box) => box.value).join("")).toBe("AB12345");
  });

  it("is keyboard-navigable: no box is removed from Tab order", () => {
    render(<Harness />);
    for (const box of getBoxes()) {
      expect(box.tabIndex).not.toBe(-1);
    }
  });

  it("shows a filled-count that tracks how many boxes hold a character", () => {
    render(<Harness />);
    // The counter is decorative (aria-hidden), so it is queried by text, not
    // role — and its presence must not disturb the group's accessible name.
    expect(screen.getByText("0/7")).not.toBeNull();
    expect(screen.getByRole("group", { name: "Domain ID" })).not.toBeNull();

    const boxes = getBoxes();
    fireEvent.change(boxes[0], { target: { value: "A" } });
    fireEvent.change(boxes[1], { target: { value: "B" } });
    expect(screen.getByText("2/7")).not.toBeNull();
  });
});
