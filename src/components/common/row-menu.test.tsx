// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RowMenu } from "./row-menu";

afterEach(cleanup);

const actions = [
  { label: "View trip details", enabled: true, onSelect: () => {} },
  {
    label: "Approve",
    enabled: false,
    disabledReason: "Only pending requests can be decided.",
    onSelect: () => {},
  },
];

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Actions for VR-1001" }));
}

describe("RowMenu disabled reasons", () => {
  it("wraps a disabled action that carries a reason in a tooltip trigger", () => {
    render(<RowMenu reference="VR-1001" actions={actions} />);
    openMenu();
    const item = screen.getByRole("menuitem", { name: "Approve" });
    expect(item.closest('[data-slot="tooltip-trigger"]')).not.toBeNull();
  });

  it("leaves enabled actions bare", () => {
    render(<RowMenu reference="VR-1001" actions={actions} />);
    openMenu();
    const item = screen.getByRole("menuitem", { name: "View trip details" });
    expect(item.closest('[data-slot="tooltip-trigger"]')).toBeNull();
  });

  it("leaves a disabled action with no reason bare", () => {
    const noReason = [
      ...actions,
      { label: "Reject", enabled: false, onSelect: () => {} },
    ];
    render(<RowMenu reference="VR-1001" actions={noReason} />);
    openMenu();
    const item = screen.getByRole("menuitem", { name: "Reject" });
    expect(item.closest('[data-slot="tooltip-trigger"]')).toBeNull();
  });
});
