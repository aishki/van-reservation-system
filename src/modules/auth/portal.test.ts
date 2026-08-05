import { describe, expect, it } from "vitest";
import { LOGIN_PORTALS, parseLoginPortal } from "@/modules/auth/service";

/**
 * `parseLoginPortal` is the whole reason a whitelisted Domain ID can be a
 * requestor. Every reading that is not exactly `"admin"` must land on the
 * associate door — a permissive parse here would restore the bug it fixes.
 */
describe("parseLoginPortal", () => {
  it("reads the admin door", () => {
    expect(parseLoginPortal("admin")).toBe("admin");
  });

  it("reads the requestor door", () => {
    expect(parseLoginPortal("requestor")).toBe("requestor");
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["empty", ""],
    ["wrong case", "Admin"],
    ["padded", " admin "],
    ["a truthy object", { portal: "admin" }],
    ["a number", 1],
    ["true", true],
  ])("falls back to the requestor door for %s", (_label, value) => {
    expect(parseLoginPortal(value)).toBe("requestor");
  });

  it("admits exactly two portals", () => {
    expect([...LOGIN_PORTALS]).toEqual(["requestor", "admin"]);
  });
});
