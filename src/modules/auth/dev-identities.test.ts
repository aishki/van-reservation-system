import { describe, expect, it } from "vitest";
import { resolveDevIdentity } from "@/modules/auth/dev-identities";

describe("resolveDevIdentity", () => {
  it("returns the matching name and email for a known Domain ID", () => {
    expect(resolveDevIdentity("AB12345")).toEqual({
      domainId: "AB12345",
      name: "Juan Dela Cruz",
      email: "juan.delacruz@carelon.com",
    });
  });

  it("returns null for an unknown Domain ID", () => {
    expect(resolveDevIdentity("ZZ99999")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(resolveDevIdentity("ab12345")).toEqual({
      domainId: "AB12345",
      name: "Juan Dela Cruz",
      email: "juan.delacruz@carelon.com",
    });
  });

  it.each([6, 8])("returns null for a %i-character input", (length) => {
    expect(resolveDevIdentity("A".repeat(length))).toBeNull();
  });
});
