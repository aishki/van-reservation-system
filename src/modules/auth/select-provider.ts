import type { Env } from "@/lib/env";
import { CgsAuthProvider } from "@/modules/auth/cgsauth";
import type { AuthProvider } from "@/modules/auth/provider";
import { StubAuthProvider } from "@/modules/auth/stub";

/**
 * Picks the concrete auth provider for the current environment. Shared by every
 * auth route (login, verify-domain) so the AUTH_MODE branch lives in exactly
 * one place.
 *
 * Returns `null` only in the should-be-impossible case of `cgsauth` without a
 * key — env parsing rejects that at boot, but the caller guards rather than
 * construct a keyless provider if the invariant is ever bypassed.
 */
export function selectAuthProvider(config: Env): AuthProvider | null {
  if (config.AUTH_MODE === "cgsauth") {
    if (!config.CGS_AUTH_API_KEY) return null;
    return new CgsAuthProvider({
      baseUrl: config.CGS_AUTH_BASE_URL,
      apiKey: config.CGS_AUTH_API_KEY,
    });
  }
  return new StubAuthProvider(config.NODE_ENV);
}
