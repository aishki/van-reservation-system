import { describe, expect, it } from "vitest";
import { ADMIN_WHITELIST_SEED } from "@/modules/auth/admin-whitelist-seed";
import { resolveDevIdentity } from "@/modules/auth/dev-identities";

describe("ADMIN_WHITELIST_SEED", () => {
  it("contains the client's nine admins", () => {
    expect(ADMIN_WHITELIST_SEED).toHaveLength(9);
  });

  it("assigns three admins to each site and three to both", () => {
    const bySite = (site: string) =>
      ADMIN_WHITELIST_SEED.filter((row) => row.site === site).length;
    expect(bySite("iloilo")).toBe(3);
    expect(bySite("manila")).toBe(3);
    expect(bySite("all")).toBe(3);
  });

  it("uses unique lowercase email addresses", () => {
    const emails = ADMIN_WHITELIST_SEED.map((row) => row.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(email).toBe(email.toLowerCase());
  });

  it("uses only the client's two corporate domains", () => {
    // Replaces the old placeholder-address guard: these are real addresses now,
    // so the check that matters is that no test or personal domain slips in.
    for (const row of ADMIN_WHITELIST_SEED) {
      expect(row.email).toMatch(/@(carelon\.com|elevancehealth\.com)$/);
    }
  });

  it("gives every row a unique seven-character Domain ID", () => {
    const domainIds = ADMIN_WHITELIST_SEED.map((row) => row.domain_id).filter(
      (id): id is string => id !== null,
    );
    expect(domainIds).toHaveLength(ADMIN_WHITELIST_SEED.length);
    expect(new Set(domainIds).size).toBe(domainIds.length);
    for (const domainId of domainIds) expect(domainId).toHaveLength(7);
  });

  // The critical cross-check: `matchWhitelist` compares Domain IDs verbatim
  // and emails case-folded. If a row's `domain_id` or `email` here drifts
  // from its `dev-identities.ts` fixture, a seeded admin's dev login
  // silently resolves to `associate` instead of `admin_support` — with no
  // error to surface the mistake. This test would fail instead.
  it("matches its dev-identities fixture by Domain ID and email", () => {
    for (const row of ADMIN_WHITELIST_SEED) {
      // A null Domain ID has nothing to key the fixture map on, so there is
      // deliberately no entry to cross-check.
      if (row.domain_id === null) continue;
      const identity = resolveDevIdentity(row.domain_id);
      expect(identity).not.toBeNull();
      expect(identity?.email.toLowerCase()).toBe(row.email.toLowerCase());
    }
  });

  describe("super_admin", () => {
    // Only these two may edit the whitelist. Everyone else is admin_support with
    // no privilege over who holds the role.
    it("grants the flag to exactly Arielle Jimera and Ruwi Joy Eribal", () => {
      const holders = ADMIN_WHITELIST_SEED.filter((row) => row.super_admin).map(
        (row) => row.domain_id,
      );
      expect(holders.sort()).toEqual(["AG80389", "AM65108"]);
    });

    it("gives every row an explicit flag, so none is privileged by omission", () => {
      for (const row of ADMIN_WHITELIST_SEED) {
        expect(typeof row.super_admin).toBe("boolean");
      }
    });

    it("does not grant the flag to Adrian Esguerra", () => {
      const row = ADMIN_WHITELIST_SEED.find(
        (candidate) => candidate.domain_id === "AG78121",
      );
      expect(row?.super_admin).toBe(false);
    });
  });
});
