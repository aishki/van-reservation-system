// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordField } from "@/components/auth/password-field";

afterEach(() => {
  cleanup();
});

const accent = {
  fieldLabel: "text-brand",
  focusRing: "focus-visible:border-brand",
  fieldBorder: "border-gray-4",
};

describe("PasswordField", () => {
  it("renders as a masked password field by default", () => {
    render(
      <PasswordField
        id="password"
        value=""
        onChange={vi.fn()}
        accent={accent}
      />,
    );
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  it("calls onChange with the typed value", () => {
    const onChange = vi.fn();
    render(
      <PasswordField
        id="password"
        value=""
        onChange={onChange}
        accent={accent}
      />,
    );
    const input = screen.getByLabelText("Password");
    fireEvent.change(input, { target: { value: "s3cret" } });
    expect(onChange).toHaveBeenCalledWith("s3cret");
  });

  it("has a reveal toggle whose accessible name starts as 'Show password'", () => {
    render(
      <PasswordField
        id="password"
        value="s3cret"
        onChange={vi.fn()}
        accent={accent}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Show password" }),
    ).not.toBeNull();
  });

  it("reveals the password and flips the toggle's accessible name when clicked", () => {
    render(
      <PasswordField
        id="password"
        value="s3cret"
        onChange={vi.fn()}
        accent={accent}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));

    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).not.toBeNull();
  });

  it("hides the password again on a second click of the toggle", () => {
    render(
      <PasswordField
        id="password"
        value="s3cret"
        onChange={vi.fn()}
        accent={accent}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));

    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  it("does not submit the form when the reveal toggle is clicked", () => {
    render(
      <form>
        <PasswordField
          id="password"
          value="s3cret"
          onChange={vi.fn()}
          accent={accent}
        />
      </form>,
    );
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle.getAttribute("type")).toBe("button");
  });
});
