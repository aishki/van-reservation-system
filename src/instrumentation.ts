// Next calls `register()` once per server process before serving traffic.
// `env()` throws on an invalid environment (e.g. a SESSION_SECRET under 32
// characters), so that failure surfaces at boot instead of on the first
// request that happens to need it.
export async function register() {
  const { env } = await import("@/lib/env");
  env();
}
