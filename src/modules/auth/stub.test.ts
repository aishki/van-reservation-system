import { describe, expect, it } from "vitest";
import type { Env } from "@/lib/env";
import { ok } from "@/lib/result";
import { resolveDevIdentity } from "@/modules/auth/dev-identities";
import { StubAuthProvider } from "@/modules/auth/stub";

const request = (body: unknown) =>
  new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("StubAuthProvider", () => {
  it("resolves a known Domain ID to its fixture identity", async () => {
    const provider = new StubAuthProvider("development");
    await expect(
      provider.identify(request({ domainId: "AB12345" })),
    ).resolves.toEqual({
      ok: true,
      value: {
        domainId: "AB12345",
        name: "Juan Dela Cruz",
        email: "juan.delacruz@carelon.com",
      },
    });
  });

  it("refuses an unknown Domain ID with NOT_AUTHENTICATED", async () => {
    const provider = new StubAuthProvider("development");
    await expect(
      provider.identify(request({ domainId: "ZZ99999" })),
    ).resolves.toEqual({ ok: false, error: "NOT_AUTHENTICATED" });
  });

  it.each([6, 8])(
    "refuses a %i-character Domain ID with NOT_AUTHENTICATED",
    async (length) => {
      const provider = new StubAuthProvider("development");
      await expect(
        provider.identify(request({ domainId: "A".repeat(length) })),
      ).resolves.toEqual({ ok: false, error: "NOT_AUTHENTICATED" });
    },
  );

  it("ignores a present password — it does not change the outcome", async () => {
    const provider = new StubAuthProvider("development");
    const withPassword = await provider.identify(
      request({ domainId: "AB12345", password: "whatever-was-typed" }),
    );
    const withoutPassword = await provider.identify(
      request({ domainId: "AB12345" }),
    );
    expect(withPassword).toEqual(withoutPassword);
  });

  it("refuses a malformed body with NOT_AUTHENTICATED", async () => {
    const provider = new StubAuthProvider("development");
    await expect(provider.identify(request({ domainId: "" }))).resolves.toEqual(
      { ok: false, error: "NOT_AUTHENTICATED" },
    );
  });

  it("refuses a non-JSON body with NOT_AUTHENTICATED", async () => {
    const provider = new StubAuthProvider("development");
    const req = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      body: "not json",
    });
    await expect(provider.identify(req)).resolves.toEqual({
      ok: false,
      error: "NOT_AUTHENTICATED",
    });
  });

  it("verifyDomain reports exists:true for a known Domain ID", async () => {
    const provider = new StubAuthProvider("development");
    await expect(provider.verifyDomain("AB12345")).resolves.toEqual({
      ok: true,
      value: { exists: true },
    });
  });

  it.each(["ZZ99999", "", "A".repeat(8)])(
    "verifyDomain reports exists:false for the unknown/invalid id %o",
    async (id) => {
      const provider = new StubAuthProvider("development");
      await expect(provider.verifyDomain(id)).resolves.toEqual({
        ok: true,
        value: { exists: false },
      });
    },
  );

  it("constructs under the test environment", () => {
    expect(() => new StubAuthProvider("test")).not.toThrow();
  });

  it("refuses to construct in production", () => {
    expect(() => new StubAuthProvider("production")).toThrow(
      /StubAuthProvider/,
    );
  });

  // The guard is an allowlist, not a blocklist: anything that is not an
  // expressly permitted non-production environment must refuse. These values are
  // unrepresentable in TypeScript once the parameter is typed `Env["NODE_ENV"]`,
  // so they are cast — they model a JS caller, an `as` cast, or a future enum
  // member, which is exactly how a fail-open guard gets reached in practice.
  it.each(["", "Production", "prod", "staging", undefined])(
    "refuses to construct for the unrecognized environment %o",
    (value) => {
      expect(
        () => new StubAuthProvider(value as unknown as Env["NODE_ENV"]),
      ).toThrow(/StubAuthProvider/);
    },
  );
});

describe("lookupName", () => {
  it("resolves a known Domain ID to its fixture name", async () => {
    const provider = new StubAuthProvider("development");
    const result = await provider.lookupName("AB12345");
    expect(result).toEqual(ok({ name: "Juan Dela Cruz" }));
  });

  it("is case-insensitive like the login path", async () => {
    const provider = new StubAuthProvider("development");
    const result = await provider.lookupName("ab12345");
    expect(result).toEqual(ok({ name: "Juan Dela Cruz" }));
  });

  it("returns null for an unknown Domain ID", async () => {
    const provider = new StubAuthProvider("development");
    const result = await provider.lookupName("ZZ99999");
    expect(result).toEqual(ok(null));
  });
});

describe("seed-dataset requestor identity", () => {
  // Her Domain ID was AJ29104 while it was invented; AM65108 is the real one
  // from the client's Admin Support list. One person, one ID.
  it("resolves AM65108 to the design's sample requestor", () => {
    expect(resolveDevIdentity("AM65108")).toEqual({
      domainId: "AM65108",
      name: "Arielle Jimera",
      email: "arielle.jimera@carelon.com",
    });
  });
});
