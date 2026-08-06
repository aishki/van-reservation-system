import { type NextRequest, NextResponse } from "next/server";
import type { AppRole } from "@/modules/auth/roles";
import { readSessionToken, SESSION_COOKIE } from "@/modules/auth/session";

const ADMIN_PREFIXES = [
  "/dashboard",
  "/master-list",
  "/calendar",
  "/reports",
  "/drivers",
  "/audit-logs",
  "/roster",
];
const LOGIN_PATHS = ["/login", "/admin/login"];
const PUBLIC_PATHS = ["/not-authorized"];

export interface RedirectInput {
  pathname: string;
  role: AppRole | null;
}

export function resolveRedirect({
  pathname,
  role,
}: RedirectInput): string | null {
  if (PUBLIC_PATHS.includes(pathname)) return null;

  const isAdminPath = ADMIN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isLoginPath = LOGIN_PATHS.includes(pathname);

  if (role === null) {
    if (isLoginPath) return null;
    return isAdminPath ? "/admin/login" : "/login";
  }

  if (isLoginPath) {
    // An associate session may still reach the ADMIN door. One person can be
    // both a requestor and an admin — which one they are is decided by the page
    // they sign in on (see `authenticate`) — so someone who signed in at /login
    // must be able to walk over and sign in again as an admin. Bouncing them
    // home here would make that impossible without signing out first.
    if (pathname === "/admin/login" && role !== "admin_support") return null;
    return role === "admin_support" ? "/dashboard" : "/";
  }

  if (isAdminPath && role !== "admin_support") {
    return "/not-authorized?reason=role";
  }

  return null;
}

export async function middleware(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  // Mirrors env.ts's `z.string().min(32)`. Without this, a secret shorter
  // than 32 characters would verify tokens happily here while `env()`
  // rejects it everywhere else, so the app boots green and every non-edge
  // route 500s on its first request.
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters for middleware to run",
    );
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSessionToken(token, secret);

  const target = resolveRedirect({
    pathname: req.nextUrl.pathname,
    role: session?.role ?? null,
  });

  if (target === null) return NextResponse.next();

  // `target` may carry a query string (e.g. "/not-authorized?reason=role").
  // Assigning it straight to `url.pathname` would percent-encode the "?" into
  // the path instead of parsing it, so split it explicitly.
  const [targetPathname, targetSearch] = target.split("?");
  const url = req.nextUrl.clone();
  url.pathname = targetPathname;
  url.search = targetSearch ? `?${targetSearch}` : "";
  return NextResponse.redirect(url);
}

// Every exclusion is anchored with a trailing separator. Without it the lookahead
// matches a bare string PREFIX, so `api` would also exclude `/apidocs` and
// `/api-status` — future routes that would then bypass this gate entirely.
//
// `_next/image` gets `(?:/|$)` rather than a bare trailing slash: Next's image
// optimizer is requested at the exact path `/_next/image` (params arrive via
// query string, never a nested segment — see `next-server.js`'s
// `pathname.startsWith('/_next/image')` check), so anchoring it the same way
// as `_next/static/<chunk>` would leave that exact path unexcluded and send
// anonymous image requests through the auth gate.
export const config = {
  matcher: [
    "/((?!api/|_next/static/|_next/image(?:/|$)|favicon.ico$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)",
  ],
};
