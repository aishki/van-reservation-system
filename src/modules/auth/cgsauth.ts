import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import { canonicalDomainId } from "@/modules/auth/domain-id";
import type {
  AssociateName,
  AuthFailure,
  AuthIdentity,
  AuthProvider,
  DomainCheck,
} from "@/modules/auth/provider";

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * The body our own login form POSTs. `domainId` is validated loosely — the CGS
 * API is the authority on the exact pattern (2 letters + 5 digits), and a
 * stricter regex here risks rejecting a real ID that does not fit the assumed
 * shape (same reasoning as `StubAuthProvider`). Both fields must be non-empty:
 * a blank submission should never spend one of the upstream login endpoint's
 * 10-per-minute attempts.
 */
const loginBody = z.object({
  domainId: z.string().trim().min(1),
  password: z.string().min(1),
});

/** CGS `POST /api/login` 200 body. Only the fields we consume are modeled. */
const loginOk = z.object({
  associate: z.object({
    domainId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
  }),
});
type LoginOk = z.infer<typeof loginOk>;

/**
 * CGS `GET /api/associate` 200 body — the full associate document, of which we
 * read only the identity fields. Every field is optional so a document missing
 * an unrelated key still parses; the caller enforces that `email` is present.
 */
const associateDoc = z.object({
  domainId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  personalNumber: z.string().optional(),
});
type AssociateDoc = z.infer<typeof associateDoc>;

export interface CgsAuthConfig {
  /** e.g. `https://teamcgs.io`. A trailing slash is tolerated. */
  baseUrl: string;
  /** The `x-api-key` issued to this application. Sent server-to-server only. */
  apiKey: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. Defaults to 8s. */
  timeoutMs?: number;
}

/**
 * Authenticates against the CGS Associate Authentication API.
 *
 * `identify` performs exactly two server-to-server calls:
 *
 *   1. `POST /api/login` — verifies the password (constant-time upstream, so a
 *      401 is deliberately identical for "unknown domain" and "wrong password").
 *   2. `GET  /api/associate` — the login response omits email and mobile, but
 *      `users.email` is NOT NULL and admin resolution can key on email, so the
 *      full record is fetched to complete the identity.
 *
 * `identify` never touches `POST /api/verifyDomain` or `POST /api/associate`
 * (unauthenticated credential registration — an account-takeover vector). This
 * application registers no credentials.
 *
 * `verifyDomain` DOES call `POST /api/verifyDomain` — deliberately, to back the
 * login form's two-step reveal (a product decision to check the Domain ID
 * before showing the password). That endpoint is an anonymous enumeration
 * oracle; using it makes casual directory enumeration possible through this
 * app, which is an accepted trade-off for the two-step UX. `identify` still
 * avoids it. The register transaction is never reachable from either method.
 */
export class CgsAuthProvider implements AuthProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: CgsAuthConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async identify(req: Request): Promise<Result<AuthIdentity, AuthFailure>> {
    let raw: unknown;
    try {
      raw = await req.clone().json();
    } catch {
      return err("NOT_AUTHENTICATED");
    }

    const parsed = loginBody.safeParse(raw);
    if (!parsed.success) return err("NOT_AUTHENTICATED");

    const login = await this.login(
      canonicalDomainId(parsed.data.domainId),
      parsed.data.password,
    );
    if (!login.ok) return login;

    const profile = await this.lookup(login.value.associate.domainId);
    if (!profile.ok) return profile;

    const identity = toIdentity(login.value.associate, profile.value);
    // A successful login with no corporate email means we cannot build a
    // record `users.email` (NOT NULL) will accept. The password was correct,
    // so this is an upstream data problem, not a credential failure.
    if (identity.email.length === 0) return err("SERVICE_UNAVAILABLE");

    return ok(identity);
  }

  async verifyDomain(
    domainId: string,
  ): Promise<Result<DomainCheck, AuthFailure>> {
    const canonical = canonicalDomainId(domainId);
    if (canonical.length === 0) return ok({ exists: false });

    const res = await this.fetchJson(`${this.baseUrl}/api/verifyDomain`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // verifyDomain is documented as public, but we send the key anyway:
        // it is the same server-side secret and future-proofs the call if the
        // platform team applies the recommended hardening (gate it behind
        // x-api-key). Harmless while the endpoint ignores it.
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({ domainId: canonical }),
    });
    if (!res.ok) return res;

    const { status } = res.value;
    if (status === 429) return err("RATE_LIMITED");
    // 200 = an active, non-disabled associate matches. 400 = none matches — a
    // definitive "does not exist", not an error to surface.
    if (status === 200) return ok({ exists: true });
    if (status === 400) return ok({ exists: false });
    // 500 (the endpoint does not guard JSON parsing) or anything unexpected:
    // we always send valid JSON, so this is an upstream problem.
    return err("SERVICE_UNAVAILABLE");
  }

  async lookupName(
    domainId: string,
  ): Promise<Result<AssociateName | null, AuthFailure>> {
    const canonical = canonicalDomainId(domainId);
    if (canonical.length === 0) return ok(null);

    const res = await this.fetchJson(
      `${this.baseUrl}/api/associate?domainId=${encodeURIComponent(canonical)}`,
      { method: "GET", headers: { "x-api-key": this.apiKey } },
    );
    if (!res.ok) return res;

    const { status, body } = res.value;
    if (status === 429) return err("RATE_LIMITED");
    // Unlike the post-login `lookup`, a miss here is a normal outcome — the
    // requestor may type any ID. 400/404 and an empty 200 body all mean "no
    // active associate matches", never an upstream failure.
    if (status === 400 || status === 404) return ok(null);
    if (status !== 200) return err("SERVICE_UNAVAILABLE");
    if (body === null) return ok(null);

    const parsed = associateDoc.safeParse(body);
    if (!parsed.success) return err("SERVICE_UNAVAILABLE");

    const firstName = (parsed.data.firstName ?? "").trim();
    const lastName = (parsed.data.lastName ?? "").trim();
    const name = `${firstName} ${lastName}`.trim();
    // A directory hit with no usable name parts cannot fill the field.
    return ok(name === "" ? null : { name });
  }

  private async login(
    domainId: string,
    password: string,
  ): Promise<Result<LoginOk, AuthFailure>> {
    const res = await this.fetchJson(`${this.baseUrl}/api/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({ domainId, password }),
    });
    if (!res.ok) return res;

    const { status, body } = res.value;
    if (status === 429) return err("RATE_LIMITED");
    if (status >= 500) return err("SERVICE_UNAVAILABLE");
    if (status !== 200) {
      // 400 (our malformed request) and 401 (bad credentials OR a bad
      // x-api-key) both land here. A rejected key is an ops misconfiguration
      // that looks identical to every user mistyping their password, but the
      // API deliberately makes the two indistinguishable, so we cannot separate
      // them without leaking whether an account exists. Treat 4xx as auth
      // failure; the 5xx outage case is handled above.
      return err("NOT_AUTHENTICATED");
    }

    const parsed = loginOk.safeParse(body);
    // A 200 that does not match the documented shape is a contract break, not a
    // credential problem.
    if (!parsed.success) return err("SERVICE_UNAVAILABLE");
    return ok(parsed.data);
  }

  private async lookup(
    domainId: string,
  ): Promise<Result<AssociateDoc, AuthFailure>> {
    const url = `${this.baseUrl}/api/associate?domainId=${encodeURIComponent(domainId)}`;
    const res = await this.fetchJson(url, {
      method: "GET",
      headers: { "x-api-key": this.apiKey },
    });
    if (!res.ok) return res;

    const { status, body } = res.value;
    if (status === 429) return err("RATE_LIMITED");
    // A 401 here means our own x-api-key was rejected for the lookup — an ops
    // problem, never the user's. Anything non-200 after a verified password is
    // an upstream failure.
    if (status !== 200) return err("SERVICE_UNAVAILABLE");

    // 200 with a null body: the associate matched at login but not on lookup.
    // Without the record we cannot assemble a complete identity.
    if (body === null) return err("SERVICE_UNAVAILABLE");

    const parsed = associateDoc.safeParse(body);
    if (!parsed.success) return err("SERVICE_UNAVAILABLE");
    return ok(parsed.data);
  }

  /**
   * A single fetch with a timeout, decoding the JSON body. Transport-level
   * failures — network error, DNS, or an aborted timeout — map to
   * SERVICE_UNAVAILABLE; the password may be correct, so this is never a
   * credential failure. Status-code interpretation is left to the caller.
   */
  private async fetchJson(
    url: string,
    init: RequestInit,
  ): Promise<Result<{ status: number; body: unknown }, AuthFailure>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      return err("SERVICE_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return ok({ status: res.status, body });
  }
}

/**
 * Builds the downstream identity from the login echo and the full record.
 * The Domain ID is canonicalized to upper-case to match the admin whitelist's
 * verbatim `domain_id` index and the dev-identity fixtures — CGS may echo any
 * case. The associate document is preferred for every field, with the login
 * echo as a fallback.
 */
function toIdentity(
  login: LoginOk["associate"],
  profile: AssociateDoc,
): AuthIdentity {
  const domainId = (profile.domainId ?? login.domainId).trim().toUpperCase();
  const firstName = (profile.firstName ?? login.firstName).trim();
  const lastName = (profile.lastName ?? login.lastName).trim();
  const name = `${firstName} ${lastName}`.trim();
  const email = profile.email?.trim() ?? "";
  const contactNumber = profile.personalNumber?.trim();

  return {
    domainId,
    name,
    email,
    ...(contactNumber ? { contactNumber } : {}),
  };
}
