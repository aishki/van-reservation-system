// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  TooltipPortalContainer,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Hint } from "./hint";

afterEach(cleanup);

describe("Hint", () => {
  it("renders children bare when `when` is false", () => {
    render(
      <Hint content="Never shown" when={false}>
        <button type="button">Remove</button>
      </Hint>,
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeDefined();
    expect(document.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
  });

  it("attaches the trigger directly to the child element", () => {
    render(
      <Hint content="Filled from your account.">
        <input aria-label="Requestor Name" readOnly value="" />
      </Hint>,
    );
    const input = screen.getByLabelText("Requestor Name");
    expect(input.getAttribute("data-slot")).toBe("tooltip-trigger");
  });

  it("shows the content when the trigger receives focus", async () => {
    render(
      <TooltipProvider delay={0}>
        <Hint content="Filled from your account.">
          <input aria-label="Requestor Name" readOnly value="" />
        </Hint>
      </TooltipProvider>,
    );
    fireEvent.focus(screen.getByLabelText("Requestor Name"));
    expect(await screen.findByText("Filled from your account.")).toBeDefined();
  });

  it("survives a press on the trigger", async () => {
    render(
      <TooltipProvider delay={0}>
        <Hint content="Filled from your account.">
          <input aria-label="Requestor Name" readOnly value="" />
        </Hint>
      </TooltipProvider>,
    );
    const input = screen.getByLabelText("Requestor Name");
    fireEvent.focus(input);
    await screen.findByText("Filled from your account.");

    fireEvent.pointerDown(input);
    fireEvent.click(input);

    expect(screen.queryByText("Filled from your account.")).not.toBeNull();
  });

  it("portals the content into the given container", async () => {
    function Harness() {
      const container = useRef<HTMLDivElement>(null);
      return (
        <TooltipProvider delay={0}>
          <div ref={container} data-testid="container" />
          <TooltipPortalContainer container={container}>
            <Hint content="Filled from your account.">
              <input aria-label="Requestor Name" readOnly value="" />
            </Hint>
          </TooltipPortalContainer>
        </TooltipProvider>
      );
    }
    render(<Harness />);
    fireEvent.focus(screen.getByLabelText("Requestor Name"));

    const content = await screen.findByText("Filled from your account.");
    expect(screen.getByTestId("container").contains(content)).toBe(true);
  });

  it("wraps a disabled child in a span trigger that owns pointer events", () => {
    render(
      <Hint
        content="A trip needs at least one passenger."
        wrap
        wrapClassName="block w-full"
      >
        <button type="button" disabled>
          −
        </button>
      </Hint>,
    );
    const trigger = document.querySelector('[data-slot="tooltip-trigger"]');
    expect(trigger?.tagName).toBe("SPAN");
    expect(trigger?.className).toContain("[&>*]:pointer-events-none");
    expect(trigger?.className).toContain("block w-full");
    expect(trigger?.querySelector("button")?.disabled).toBe(true);
  });
});
