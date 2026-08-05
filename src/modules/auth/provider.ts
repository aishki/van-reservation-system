import type { ErrorCode } from "@/lib/api-error";
import type { Result } from "@/lib/result";

export interface AuthIdentity {
  domainId: string;
  name: string;
  email: string;
  contactNumber?: string;
}

/**
 * The failures a provider may report. Kept as a subset of `ErrorCode` via
 * `Extract`, so removing one of these from `ERROR_STATUS` breaks compilation
 * here rather than letting the two drift:
 *
 * - `NOT_AUTHENTICATED` — the credential was rejected (or the request was
 *   malformed). A user-caused failure.
 * - `SERVICE_UNAVAILABLE` — the upstream provider was unreachable, timed out,
 *   returned 5xx, or rejected *our own* API key. Not the user's fault; the
 *   password may well be correct.
 * - `RATE_LIMITED` — the upstream provider's fixed-window cap was hit.
 */
export type AuthFailure = Extract<
  ErrorCode,
  "NOT_AUTHENTICATED" | "SERVICE_UNAVAILABLE" | "RATE_LIMITED"
>;

/**
 * The outcome of a pre-login Domain ID check. `exists` is the only bit the
 * login UI needs (whether to reveal the password step). Deliberately does NOT
 * carry the name or `registered` flag: this runs before authentication, so the
 * less it discloses the smaller the enumeration surface.
 */
export interface DomainCheck {
  exists: boolean;
}

/**
 * A directory match for a passenger-name lookup — the display name only.
 * Deliberately not `AuthIdentity`: a passenger lookup must not disclose
 * email or contact details to other associates.
 */
export interface AssociateName {
  name: string;
}

/**
 * The only surface the organization's auth service must satisfy. Everything
 * downstream — role resolution, sessions — depends on this interface and never
 * on a concrete provider.
 *
 * `identify` returns a `Result` rather than `AuthIdentity | null` so a caller
 * can tell a rejected credential apart from an upstream outage or a rate
 * limit — three outcomes that must reach the user as different messages.
 *
 * `verifyDomain` backs the login form's two-step reveal: it reports whether a
 * Domain ID belongs to an active associate, without proving anything about the
 * password. A non-existent ID is a successful `ok({ exists: false })`, not a
 * failure — failures are reserved for an upstream outage or rate limit.
 *
 * `lookupName` backs the booking wizard's passenger rows: it resolves a
 * Domain ID to a display name for a signed-in requestor. A non-match is
 * `ok(null)`, never a failure — failures are reserved for an upstream outage
 * or rate limit.
 */
export interface AuthProvider {
  identify(req: Request): Promise<Result<AuthIdentity, AuthFailure>>;
  verifyDomain(domainId: string): Promise<Result<DomainCheck, AuthFailure>>;
  lookupName(
    domainId: string,
  ): Promise<Result<AssociateName | null, AuthFailure>>;
}
