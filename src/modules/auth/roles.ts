export const APP_ROLES = ["associate", "admin_support"] as const;
export type AppRole = (typeof APP_ROLES)[number];

// Same pattern as APP_ROLES: a runtime array the type derives from, so a
// schema-drift test can enumerate it instead of only the type checker seeing
// the values. `admin_whitelist_site_check` in the auth-tables migration must
// admit exactly this set — see schema-constraints.int.test.ts.
export const ADMIN_SITES = ["iloilo", "manila", "all"] as const;
export type AdminSite = (typeof ADMIN_SITES)[number];

export interface WhitelistEntry {
  domain_id: string | null;
  email: string | null;
  site: AdminSite;
  active: boolean;
  /** May edit `admin_whitelist` itself. See `admin-whitelist-seed.ts`. */
  super_admin: boolean;
}

export interface RoleIdentity {
  domainId: string;
  email: string;
}

/**
 * A blank key is NOT a key. `email = ''` is schema-legal — the identity CHECK
 * only requires one of email/domain_id to be non-null — so guarding `!== null`
 * alone lets a provider that maps a missing claim to `""` match that row and be
 * granted `admin_support` with `site: 'all'`. Trim, then treat empty as absent.
 */
const asKey = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Domain ID is the stronger key and wins when both could match — an email can
 * be reassigned, a Domain ID cannot.
 *
 * Case handling is deliberately asymmetric, mirroring each key's storage:
 * `admin_whitelist_domain_id_idx` is a plain unique index, so Domain IDs are
 * compared verbatim; `admin_whitelist_email_lower_trim_idx` is on
 * `lower(trim(email))`, so emails are case-folded AND trimmed of surrounding
 * whitespace. Do NOT lowercase `domain_id` here without a paired
 * migration to `unique (lower(domain_id))` — the current index permits `AB12345`
 * and `ab12345` as distinct rows, and folding without it would make `find`
 * nondeterministic across an unordered result set.
 */
export function matchWhitelist(
  identity: RoleIdentity,
  entries: readonly WhitelistEntry[],
): WhitelistEntry | null {
  const active = entries.filter((e) => e.active);

  const domainId = asKey(identity.domainId);
  if (domainId !== null) {
    const byDomain = active.find((e) => asKey(e.domain_id) === domainId);
    if (byDomain) return byDomain;
  }

  const email = asKey(identity.email)?.toLowerCase() ?? null;
  if (email === null) return null;
  return active.find((e) => asKey(e.email)?.toLowerCase() === email) ?? null;
}

export function resolveRole(
  identity: RoleIdentity,
  entries: readonly WhitelistEntry[],
): AppRole {
  return matchWhitelist(identity, entries) === null
    ? "associate"
    : "admin_support";
}

/**
 * Whether this identity may edit the whitelist.
 *
 * Reuses `matchWhitelist`, so the privilege inherits its rules exactly — the
 * active filter, and Domain ID winning over email. A second matcher here would
 * be a second thing to keep in step, with the failure mode that the role and
 * the privilege disagree about who someone is.
 */
export function resolveSuperAdmin(
  identity: RoleIdentity,
  entries: readonly WhitelistEntry[],
): boolean {
  return matchWhitelist(identity, entries)?.super_admin ?? false;
}
