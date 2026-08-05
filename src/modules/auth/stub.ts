import { z } from "zod";
import type { Env } from "@/lib/env";
import { err, ok, type Result } from "@/lib/result";
import { resolveDevIdentity } from "@/modules/auth/dev-identities";
import type {
  AssociateName,
  AuthFailure,
  AuthIdentity,
  AuthProvider,
  DomainCheck,
} from "@/modules/auth/provider";

// Domain IDs are exactly seven characters (e.g. `AB12345`). Deliberately
// NOT a two-letters-then-five-digits pattern: that shape is what the seven
// boxes on the Figma form suggest, not a guarantee, and a stricter regex
// risks locking out a real ID that doesn't fit the assumed format.
const stubBody = z.object({
  domainId: z.string().length(7),
  password: z.string().optional(),
});

// Allowlist, deliberately — NOT `nodeEnv === "production"`. A blocklist fails
// OPEN: it admits the stub for `undefined`, `""`, `"Production"`, a typo, or any
// environment name added later. This stub takes its identity from the request
// body, so admitting it in production would let any caller assert any identity.
const STUB_PERMITTED_ENVIRONMENTS = new Set<string>(["development", "test"]);

export class StubAuthProvider implements AuthProvider {
  // Typed `Env["NODE_ENV"]` so callers cannot pass an unvalidated raw string;
  // the runtime check still stands for JS callers and `as` casts.
  constructor(nodeEnv: Env["NODE_ENV"]) {
    if (!STUB_PERMITTED_ENVIRONMENTS.has(nodeEnv)) {
      throw new Error(
        "StubAuthProvider must never be used in production — set AUTH_MODE=cgsauth",
      );
    }
  }

  async identify(req: Request): Promise<Result<AuthIdentity, AuthFailure>> {
    let raw: unknown;
    try {
      raw = await req.clone().json();
    } catch {
      return err("NOT_AUTHENTICATED");
    }

    const parsed = stubBody.safeParse(raw);
    if (!parsed.success) return err("NOT_AUTHENTICATED");

    // The password is intentionally ignored — the stub verifies no passwords.
    // Real credential verification lives in `CgsAuthProvider`; here the Domain
    // ID alone selects a fixture identity, and an unknown one is refused rather
    // than fabricated. A local fixture never has an outage or a rate limit, so
    // the only failure this provider emits is NOT_AUTHENTICATED.
    const identity = resolveDevIdentity(parsed.data.domainId);
    return identity === null ? err("NOT_AUTHENTICATED") : ok(identity);
  }

  async verifyDomain(
    domainId: string,
  ): Promise<Result<DomainCheck, AuthFailure>> {
    // A fixture lookup, so "exists" is simply whether the Domain ID is one of
    // the dev identities. No network, so no outage or rate limit to report.
    return ok({ exists: resolveDevIdentity(domainId) !== null });
  }

  async lookupName(
    domainId: string,
  ): Promise<Result<AssociateName | null, AuthFailure>> {
    // The same fixture the login path trusts. A local fixture has no outage
    // or rate limit to report, so a miss is always a plain null.
    const identity = resolveDevIdentity(domainId);
    return ok(identity === null ? null : { name: identity.name });
  }
}
