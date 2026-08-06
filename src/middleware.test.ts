import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { middleware, resolveRedirect } from "@/middleware";

describe("resolveRedirect", () => {
  it("sends an anonymous visitor from an admin path to the admin login", () => {
    expect(resolveRedirect({ pathname: "/dashboard", role: null })).toBe(
      "/admin/login",
    );
  });

  it("sends an anonymous visitor from a requestor path to the requestor login", () => {
    expect(resolveRedirect({ pathname: "/manage", role: null })).toBe("/login");
  });

  it("keeps an associate out of admin paths", () => {
    expect(resolveRedirect({ pathname: "/dashboard", role: "associate" })).toBe(
      "/not-authorized?reason=role",
    );
  });

  it("allows an admin into admin paths", () => {
    expect(
      resolveRedirect({ pathname: "/dashboard", role: "admin_support" }),
    ).toBeNull();
  });

  it("allows an admin to browse requestor paths", () => {
    expect(
      resolveRedirect({ pathname: "/manage", role: "admin_support" }),
    ).toBeNull();
  });

  it("moves a signed-in admin off a login page to the dashboard", () => {
    expect(
      resolveRedirect({ pathname: "/admin/login", role: "admin_support" }),
    ).toBe("/dashboard");
    expect(resolveRedirect({ pathname: "/login", role: "admin_support" })).toBe(
      "/dashboard",
    );
  });

  it("moves a signed-in associate off the requestor login page to the portal", () => {
    expect(resolveRedirect({ pathname: "/login", role: "associate" })).toBe(
      "/",
    );
  });

  // The two doors resolve different roles for the same person (see
  // `authenticate`), so an associate session must be able to reach the admin
  // door and escalate. Bouncing them home would make an admin who signed in at
  // /login unable to reach the dashboard without signing out first.
  it("lets an associate session reach the ADMIN login page", () => {
    expect(
      resolveRedirect({ pathname: "/admin/login", role: "associate" }),
    ).toBeNull();
  });

  it("leaves login pages alone for anonymous visitors", () => {
    expect(resolveRedirect({ pathname: "/login", role: null })).toBeNull();
    expect(
      resolveRedirect({ pathname: "/admin/login", role: null }),
    ).toBeNull();
  });

  it("leaves the not-authorized page reachable by anyone", () => {
    expect(
      resolveRedirect({ pathname: "/not-authorized", role: null }),
    ).toBeNull();
    expect(
      resolveRedirect({ pathname: "/not-authorized", role: "associate" }),
    ).toBeNull();
  });

  it("lets an associate into their own area", () => {
    expect(
      resolveRedirect({ pathname: "/manage", role: "associate" }),
    ).toBeNull();
  });

  // These pin the admin-path boundary. Without them, "simplifying" the check to a
  // bare startsWith(prefix) would regress silently in both directions: /dashboardXYZ
  // would become admin-gated, and a sub-path could stop being gated at all.
  it("gates admin sub-paths, not just the exact prefix", () => {
    expect(
      resolveRedirect({ pathname: "/dashboard/123", role: "associate" }),
    ).toBe("/not-authorized?reason=role");
    expect(
      resolveRedirect({ pathname: "/reports/2024", role: "associate" }),
    ).toBe("/not-authorized?reason=role");
  });

  it("does not treat a path merely prefixed by an admin route as admin", () => {
    expect(resolveRedirect({ pathname: "/dashboardXYZ", role: null })).toBe(
      "/login",
    );
    expect(
      resolveRedirect({ pathname: "/master-listing", role: "associate" }),
    ).toBeNull();
  });

  it("admits an admin to admin sub-paths", () => {
    expect(
      resolveRedirect({ pathname: "/dashboard/123", role: "admin_support" }),
    ).toBeNull();
  });
});

// env.ts requires `SESSION_SECRET` to be at least 32 characters. If this
// check disagreed, a shorter secret would verify tokens happily here while
// every non-edge route 500s on `env()` — booting green into a broken app.
describe("middleware secret guard", () => {
  const originalSecret = process.env.SESSION_SECRET;

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  it("throws when SESSION_SECRET is unset", async () => {
    delete process.env.SESSION_SECRET;
    const req = new NextRequest("http://localhost:3000/login");
    await expect(middleware(req)).rejects.toThrow(/SESSION_SECRET/);
  });

  it("throws when SESSION_SECRET is shorter than 32 characters", async () => {
    process.env.SESSION_SECRET = "too-short";
    const req = new NextRequest("http://localhost:3000/login");
    await expect(middleware(req)).rejects.toThrow(/SESSION_SECRET/);
  });

  it("runs normally once SESSION_SECRET meets the 32-character minimum", async () => {
    process.env.SESSION_SECRET = "0123456789012345678901234567890123";
    const req = new NextRequest("http://localhost:3000/login");
    await expect(middleware(req)).resolves.toBeDefined();
  });
});

// ADMIN_PREFIXES is a hand-written list. This enumerates the actual route
// directories under `src/app/(admin)/` so a new admin route that forgets to
// update the list fails this test instead of shipping ungated. All five
// (dashboard, master-list, reports, drivers, calendar) now exist.
describe("ADMIN_PREFIXES stays in sync with src/app/(admin)/", () => {
  const adminDir = path.join(import.meta.dirname, "app", "(admin)");
  const adminRoutes = readdirSync(adminDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // Only directories that actually resolve to a route. Without this filter,
    // colocating a `_components/` or `(group)/` folder under (admin) fails this
    // test even though nothing new is reachable — and a guard that cries wolf is
    // a guard someone deletes. Next treats a `_`-prefixed folder as private and
    // a `(…)` folder as a non-URL group, and a directory with no `page.tsx` has
    // no route of its own.
    .filter(
      (entry) => !entry.name.startsWith("_") && !entry.name.startsWith("("),
    )
    .filter((entry) => existsSync(path.join(adminDir, entry.name, "page.tsx")))
    .map((entry) => entry.name);

  it("found at least one admin route directory to check", () => {
    expect(adminRoutes.length).toBeGreaterThan(0);
  });

  it.each(adminRoutes)("gates /%s for a non-admin role", (route) => {
    expect(resolveRedirect({ pathname: `/${route}`, role: "associate" })).toBe(
      "/not-authorized?reason=role",
    );
  });
});
