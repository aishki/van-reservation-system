import { describe, expect, it, vi } from "vitest";

const { SECRET } = vi.hoisted(() => ({
  SECRET: "0123456789012345678901234567890123",
}));

// requireUser/requireAdmin route through getSessionUser, which reads
// `next/headers` and `@/lib/env`. Mocking both keeps this a unit test — no
// Next request context, no real environment — while exercising the refusal
// paths the route-handler layer will depend on.
let cookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieValue === undefined ? undefined : { value: cookieValue }),
  }),
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ SESSION_SECRET: SECRET }),
}));

const { createSessionToken } = await import("@/modules/auth/session");
const { requireAdmin, requireUser } = await import("@/modules/auth/service");

const associate = {
  userId: "6f1c1b3e-0000-4000-8000-000000000001",
  domainId: "AB12345",
  name: "Juan Dela Cruz",
  email: "juan.delacruz@carelon.com",
  role: "associate" as const,
  superAdmin: false,
};

const admin = { ...associate, role: "admin_support" as const };

describe("requireUser", () => {
  it("refuses with NOT_AUTHENTICATED when there is no session", async () => {
    cookieValue = undefined;
    expect(await requireUser()).toEqual({
      ok: false,
      error: "NOT_AUTHENTICATED",
    });
  });

  it("admits a valid session", async () => {
    cookieValue = await createSessionToken(associate, SECRET);
    expect(await requireUser()).toEqual({ ok: true, value: associate });
  });
});

describe("requireAdmin", () => {
  it("refuses with NOT_AUTHENTICATED when there is no session", async () => {
    cookieValue = undefined;
    expect(await requireAdmin()).toEqual({
      ok: false,
      error: "NOT_AUTHENTICATED",
    });
  });

  it("refuses with FORBIDDEN for a signed-in associate", async () => {
    cookieValue = await createSessionToken(associate, SECRET);
    expect(await requireAdmin()).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("admits a signed-in admin_support user", async () => {
    cookieValue = await createSessionToken(admin, SECRET);
    expect(await requireAdmin()).toEqual({ ok: true, value: admin });
  });
});
