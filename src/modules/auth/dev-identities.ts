import { canonicalDomainId } from "@/modules/auth/domain-id";
import type { AuthIdentity } from "@/modules/auth/provider";

/**
 * Development-only identity fixture. There is no real auth service yet —
 * `cgsauth.ts` arrives in Slice 5 — so `StubAuthProvider` cannot verify a
 * password or look up a real directory entry. It trusts the Domain ID typed
 * into the login form and resolves the name and email from this map
 * instead. This file becomes dead code the day `cgsauth.ts` lands.
 *
 * Emails here MUST match the corresponding `ADMIN_WHITELIST_SEED` row
 * exactly (case-insensitively — whitelist email matching is case-folded) so
 * a seeded admin's Domain ID resolves to `admin_support` rather than
 * silently demoting to `associate`. See `resolveRole` in `roles.ts`.
 *
 * A whitelist row with a null `domain_id` has no entry here by definition:
 * this map is keyed by Domain ID, and there is nothing to key it on.
 */

interface DevIdentityFixture {
  name: string;
  email: string;
}

// Keyed by the canonical (upper-case) Domain ID. `resolveDevIdentity`
// upper-cases its input before lookup, and `ADMIN_WHITELIST_SEED.domain_id`
// values are upper-case too — `matchWhitelist` compares Domain IDs verbatim,
// so all three must agree on case or the match silently misses.
const DEV_IDENTITIES: Readonly<Record<string, DevIdentityFixture>> =
  Object.freeze({
    // Seeded admins — one entry per `ADMIN_WHITELIST_SEED` row that HAS a
    // Domain ID, which is currently all of them.
    AG80389: {
      name: "Ruwi Joy Eribal",
      email: "ruwijoy.eribal@carelon.com",
    },
    AM37315: {
      name: "Norlen Denonong",
      email: "norlen.denonong2@elevancehealth.com",
    },
    AL12138: {
      name: "Zarra Crist Bartolo",
      email: "zarracrist.bartolo@carelon.com",
    },
    AM03146: {
      name: "Jezreel Mariz Gromia",
      email: "jezreelmariz.gromia2@elevancehealth.com",
    },
    AH85664: {
      name: "Sharon Gemma Lim",
      email: "sharongemma.lim@elevancehealth.com",
    },
    AL95338: {
      name: "Ivy Balandra",
      email: "ivy.balandra@carelon.com",
    },
    AM65108: {
      name: "Arielle Jimera",
      email: "arielle.jimera@carelon.com",
    },
    AH44229: {
      name: "Angel Grace Mateo",
      email: "angelgrace.mateo@carelon.com",
    },
    AJ40001: {
      name: "Aishki Hyamero",
      email: "arielle.hyamero@carelon.com",
    },

    // Non-admin associates, fixture-only — absent from the whitelist, so
    // they resolve to the `associate` role.
    AB12345: {
      name: "Juan Dela Cruz",
      email: "juan.delacruz@carelon.com",
    },
    CD67890: {
      name: "Maria Santos",
      email: "maria.santos@carelon.com",
    },
  });

/**
 * Resolves a 7-character Domain ID to its fixture identity. Returns `null`
 * for a wrong-length input or an ID absent from the fixture — an unknown
 * Domain ID is refused, never fabricated into an identity.
 */
export function resolveDevIdentity(domainId: string): AuthIdentity | null {
  const canonical = canonicalDomainId(domainId);
  if (canonical.length !== 7) return null;

  const fixture = DEV_IDENTITIES[canonical];
  if (fixture === undefined) return null;

  return { domainId: canonical, name: fixture.name, email: fixture.email };
}
