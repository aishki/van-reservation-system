import { describe, expect, it } from "vitest";
import { diffFields, type FieldSpec } from "@/modules/roster/events";

const SPECS: FieldSpec[] = [
  { field: "name", label: "Name" },
  { field: "mobile", label: "Mobile" },
  { field: "shift", label: "Shift" },
];

describe("diffFields", () => {
  it("returns nothing when no field moved", () => {
    const row = { name: "Ronald Japitana", mobile: "09171234567", shift: null };
    expect(diffFields(row, row, SPECS)).toEqual([]);
  });

  it("reports a changed field with both sides and its label", () => {
    expect(
      diffFields(
        { name: "Ronald Japitana", mobile: "09171234567", shift: null },
        { name: "Ronald Japitana", mobile: "09990001111", shift: null },
        SPECS,
      ),
    ).toEqual([
      {
        field: "mobile",
        label: "Mobile",
        from: "09171234567",
        to: "09990001111",
      },
    ]);
  });

  it("renders an absent value as null, not as an empty string", () => {
    // `null` means "held nothing before" in FieldChange, and the audit page's
    // ChangeList renders it as an em dash. "" would read as a blank value.
    expect(
      diffFields({ shift: null }, { shift: "11AM-11PM" }, [
        { field: "shift", label: "Shift" },
      ]),
    ).toEqual([
      { field: "shift", label: "Shift", from: null, to: "11AM-11PM" },
    ]);
  });

  it("ignores fields not named in the specs", () => {
    // The spec list is the allowlist: a column nobody declared must not leak
    // into an audit row, which is how a secret ends up in a permanent log.
    expect(
      diffFields({ name: "A", secret: "x" }, { name: "A", secret: "y" }, SPECS),
    ).toEqual([]);
  });

  it("reports several moved fields in spec order, not object order", () => {
    const changes = diffFields(
      { name: "A", mobile: "1", shift: null },
      { name: "B", mobile: "2", shift: null },
      SPECS,
    );
    expect(changes.map((c) => c.field)).toEqual(["name", "mobile"]);
  });

  it("stringifies a boolean so both sides are display strings", () => {
    expect(
      diffFields({ notify: true }, { notify: false }, [
        { field: "notify", label: "Notify" },
      ]),
    ).toEqual([{ field: "notify", label: "Notify", from: "Yes", to: "No" }]);
  });
});
