import { describe, expect, it } from "vitest";
import {
  matchWhitelist,
  resolveRole,
  resolveSuperAdmin,
  type WhitelistEntry,
} from "@/modules/auth/roles";

const entry = (over: Partial<WhitelistEntry> = {}): WhitelistEntry => ({
  domain_id: null,
  email: "ivy.balandra@carelon.com",
  site: "iloilo",
  active: true,
  super_admin: false,
  ...over,
});

const identity = { domainId: "AB12345", email: "ivy.balandra@carelon.com" };

describe("resolveRole", () => {
  it("assigns admin_support to a whitelisted email", () => {
    expect(resolveRole(identity, [entry()])).toBe("admin_support");
  });

  it("matches whitelisted emails case-insensitively", () => {
    expect(
      resolveRole({ ...identity, email: "IVY.BALANDRA@carelon.com" }, [
        entry({ email: "ivy.balandra@carelon.com" }),
      ]),
    ).toBe("admin_support");
  });

  it("assigns associate by default", () => {
    expect(
      resolveRole({ domainId: "ZZ99999", email: "someone@carelon.com" }, [
        entry(),
      ]),
    ).toBe("associate");
  });

  it("ignores inactive entries", () => {
    expect(resolveRole(identity, [entry({ active: false })])).toBe("associate");
  });

  it("assigns associate when the whitelist is empty", () => {
    expect(resolveRole(identity, [])).toBe("associate");
  });
});

describe("matchWhitelist", () => {
  it("prefers a domain_id match over an email match", () => {
    const byDomain = entry({
      domain_id: "AB12345",
      email: "other@carelon.com",
      site: "all",
    });
    const byEmail = entry({ site: "iloilo" });
    expect(matchWhitelist(identity, [byEmail, byDomain])?.site).toBe("all");
  });

  it("returns the matched entry so callers can read its site", () => {
    expect(matchWhitelist(identity, [entry({ site: "iloilo" })])?.site).toBe(
      "iloilo",
    );
  });

  it("returns null when nothing matches", () => {
    expect(
      matchWhitelist({ domainId: "NOPE", email: "nope@carelon.com" }, [
        entry(),
      ]),
    ).toBeNull();
  });

  // A blank key must never match. These are the refusal paths that make the
  // difference between "no role" and "admin_support with site: all".
  it("does not match a blank email on either side", () => {
    expect(
      matchWhitelist({ domainId: "", email: "" }, [
        entry({ domain_id: null, email: "" }),
      ]),
    ).toBeNull();
  });

  it("does not match a blank domain_id on either side", () => {
    expect(
      matchWhitelist({ domainId: "", email: "nobody@carelon.com" }, [
        entry({ domain_id: "", email: null }),
      ]),
    ).toBeNull();
  });

  it("does not match a whitespace-only key", () => {
    expect(
      matchWhitelist({ domainId: "   ", email: "  " }, [
        entry({ domain_id: "   ", email: null }),
      ]),
    ).toBeNull();
  });

  it("matches an email stored with surrounding whitespace", () => {
    expect(
      matchWhitelist(identity, [entry({ email: ` ${identity.email} ` })]),
    ).not.toBeNull();
  });

  it("returns null when an entry has neither key", () => {
    expect(
      matchWhitelist(identity, [entry({ domain_id: null, email: null })]),
    ).toBeNull();
  });

  // Case handling is asymmetric by design — see the doc comment on
  // matchWhitelist. These two tests pin it so a future change cannot flip it
  // silently in either direction.
  it("compares domain_id case-sensitively", () => {
    expect(
      matchWhitelist({ domainId: "ab12345", email: "nobody@carelon.com" }, [
        entry({ domain_id: "AB12345", email: null }),
      ]),
    ).toBeNull();
  });

  it("compares email case-insensitively", () => {
    expect(
      matchWhitelist({ domainId: "NOPE", email: "IVY.BALANDRA@CARELON.COM" }, [
        entry({ domain_id: null, email: "ivy.balandra@carelon.com" }),
      ]),
    ).not.toBeNull();
  });

  it("does not let an inactive domain_id row shadow an active email row", () => {
    const inactiveDomain = entry({
      domain_id: identity.domainId,
      email: null,
      active: false,
      site: "manila",
    });
    const activeEmail = entry({ domain_id: null, site: "iloilo" });
    expect(matchWhitelist(identity, [inactiveDomain, activeEmail])?.site).toBe(
      "iloilo",
    );
  });
});

describe("resolveSuperAdmin", () => {
  const entries: WhitelistEntry[] = [
    {
      domain_id: "AM65108",
      email: "arielle.jimera@carelon.com",
      site: "all",
      active: true,
      super_admin: true,
    },
    {
      domain_id: "AL95338",
      email: "ivy.balandra@carelon.com",
      site: "iloilo",
      active: true,
      super_admin: false,
    },
  ];

  it("is true for a holder", () => {
    expect(
      resolveSuperAdmin(
        { domainId: "AM65108", email: "arielle.jimera@carelon.com" },
        entries,
      ),
    ).toBe(true);
  });

  it("is false for an admin who is not a holder", () => {
    expect(
      resolveSuperAdmin(
        { domainId: "AL95338", email: "ivy.balandra@carelon.com" },
        entries,
      ),
    ).toBe(false);
  });

  // Fail closed: nobody off the whitelist is privileged.
  it("is false for an identity that matches no row", () => {
    expect(
      resolveSuperAdmin(
        { domainId: "ZZ00000", email: "nobody@x.invalid" },
        entries,
      ),
    ).toBe(false);
  });

  // An inactive row grants nothing — matchWhitelist already filters on active,
  // and this pins that the privilege inherits that filter.
  it("is false when the holder's row is inactive", () => {
    const inactive = entries.map((e) => ({ ...e, active: false }));
    expect(
      resolveSuperAdmin(
        { domainId: "AM65108", email: "arielle.jimera@carelon.com" },
        inactive,
      ),
    ).toBe(false);
  });
});
