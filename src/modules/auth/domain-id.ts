/**
 * Canonicalises a Domain ID to the form every store and comparison assumes:
 * trimmed and upper case. `ADMIN_WHITELIST_SEED`, `users.domain_id` and
 * `reservation_passengers.domain_id` all hold upper case, `matchWhitelist`
 * compares verbatim, and the CGS directory rejects a lower-case ID outright.
 *
 * The login form's boxes render upper case through CSS alone, so a typed
 * `aj29104` looks identical on screen to the ID that actually works — which is
 * why canonicalising has to happen on the value, not only in the styling.
 */
export function canonicalDomainId(value: string): string {
  return value.trim().toUpperCase();
}
