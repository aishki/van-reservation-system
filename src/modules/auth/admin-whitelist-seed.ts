import type { AdminSite } from "@/modules/auth/roles";

export interface AdminSeedRow {
  full_name: string;
  email: string;
  /**
   * Nullable because the table's `admin_whitelist_identity_check` requires an
   * email OR a Domain ID, not both, and `matchWhitelist` falls back to a
   * case-folded email comparison — so an ID-less row still resolves the admin
   * role at login. No row uses that today; one that did could not be
   * stub-logged-in locally, since `dev-identities.ts` is keyed by Domain ID.
   */
  domain_id: string | null;
  site: AdminSite;
  /**
   * May edit `admin_whitelist` itself — create, edit, deactivate, and grant or
   * revoke this flag on others. NOT the same as `admin_support`, which every
   * row here has: that role approves trips and says nothing about who holds it.
   *
   * Explicit on every row rather than optional, so a new person is never
   * privileged by omission.
   */
  super_admin: boolean;
}

/**
 * Admin Support, from the list supplied by the client.
 *
 * `site` is a NOTIFICATION filter, never a permission boundary — Admin Support
 * is one flat role and any admin may act on any request. An `all` row is
 * someone who wants both offices' mail. See `adminRecipients`.
 *
 * **These are real addresses.** Any environment running `EMAIL_MODE=ses` mails
 * actual people from this table. `EMAIL_MODE` defaults to `stub` and the stub
 * throws in production, so it cannot happen by drift — but a staging box set to
 * `ses` reaches them.
 *
 * Emails are stored lower-cased: the unique index is on `lower(email)` and
 * `matchWhitelist` compares case-folded, so storing the supplied mixed case
 * would risk a second row for the same person differing only by capitals.
 *
 * Every `domain_id` here MUST match its `dev-identities.ts` fixture exactly
 * (same upper-case form) — `matchWhitelist` compares Domain IDs verbatim, so a
 * mismatch silently demotes a seeded admin to `associate` with nothing to
 * surface the mistake. `admin-whitelist-seed.test.ts` guards that.
 */
export const ADMIN_WHITELIST_SEED: readonly AdminSeedRow[] = [
  {
    full_name: "Ruwi Joy Eribal",
    email: "ruwijoy.eribal@carelon.com",
    domain_id: "AG80389",
    site: "all",
    super_admin: true,
  },
  {
    full_name: "Norlen Denonong",
    email: "norlen.denonong2@elevancehealth.com",
    domain_id: "AM37315",
    site: "manila",
    super_admin: false,
  },
  {
    full_name: "Zarra Crist Bartolo",
    email: "zarracrist.bartolo@carelon.com",
    domain_id: "AL12138",
    site: "manila",
    super_admin: false,
  },
  {
    full_name: "Jezreel Mariz Gromia",
    email: "jezreelmariz.gromia2@elevancehealth.com",
    domain_id: "AM03146",
    site: "iloilo",
    super_admin: false,
  },
  {
    full_name: "Sharon Gemma Lim",
    email: "sharongemma.lim@elevancehealth.com",
    domain_id: "AH85664",
    site: "manila",
    super_admin: false,
  },
  {
    full_name: "Angel Grace Mateo",
    email: "angelgrace.mateo@carelon.com",
    domain_id: "AH44229",
    site: "iloilo",
    super_admin: false,
  },
  {
    full_name: "Ivy Balandra",
    email: "ivy.balandra@carelon.com",
    domain_id: "AL95338",
    site: "iloilo",
    super_admin: false,
  },
  {
    full_name: "Arielle Jimera",
    email: "arielle.jimera@carelon.com",
    domain_id: "AM65108",
    site: "all",
    super_admin: true,
  },
  {
    // A test admin, not a member of staff. `site: "all"` so it receives every
    // site's notifications, which is the point of a test account.
    full_name: "Aishki Hyamero",
    email: "arielle.hyamero@carelon.com",
    domain_id: "AJ40001",
    site: "all",
    super_admin: false,
  },
] as const;
