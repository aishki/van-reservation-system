// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DrawerSelect } from "@/components/admin/trip-drawer/drawer-parts";

afterEach(() => {
  cleanup();
});

describe("DrawerSelect", () => {
  it("leaves the placeholder selectable while nothing is assigned", () => {
    render(
      <DrawerSelect
        label="Driver"
        value=""
        options={[{ value: "driver-1", label: "Villanueva, Rey" }]}
        placeholder="Not assigned yet"
        onChange={() => {}}
      />,
    );

    const placeholder = screen.getByRole("option", {
      name: "Not assigned yet",
    }) as HTMLOptionElement;
    expect(placeholder.disabled).toBe(false);
  });

  // The bug this guards: selecting "Not assigned yet" over an assigned value
  // maps to null, which driverInputOf/vanInputOf treat as "leave unchanged" —
  // so it must not remain a choice once something is assigned.
  it("disables the placeholder once a value is assigned", () => {
    render(
      <DrawerSelect
        label="Driver"
        value="driver-1"
        options={[{ value: "driver-1", label: "Villanueva, Rey" }]}
        placeholder="Not assigned yet"
        onChange={() => {}}
      />,
    );

    const placeholder = screen.getByRole("option", {
      name: "Not assigned yet",
      hidden: true,
    }) as HTMLOptionElement;
    expect(placeholder.disabled).toBe(true);
  });
});
