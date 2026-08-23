/**
 * Shared guard for the email preview routes.
 *
 * These live under `/api/` on purpose. The middleware matcher in
 * `src/middleware.ts` excludes `api/`, so a page route at `/dev/email` would be
 * bounced to the login screen before it ever rendered — the preview would need
 * a session to show a template that has nothing to do with one.
 */
export function devOnly(): Response | null {
  // Read at request time rather than at module scope: `vi.stubEnv` in the route
  // test cannot reach a value captured when the module was first imported.
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }
  return null;
}

/** The index builds HTML by hand; fixture titles are ours, but not sanitising
 * a value on its way into markup is a habit worth keeping even here. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
