import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";

vi.mock("@/modules/auth/service", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/modules/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/admins/repo", () => ({
  listAdmins: vi.fn(),
  createAdmin: vi.fn(),
  isSuperAdmin: vi.fn(),
}));

import { createAdmin, isSuperAdmin, listAdmins } from "@/modules/admins/repo";
import { requireAdmin } from "@/modules/auth/service";
import { GET, POST } from "./route";

const requireAdminMock = vi.mocked(requireAdmin);
const isSuperAdminMock = vi.mocked(isSuperAdmin);
const listMock = vi.mocked(listAdmins);
const createAdminMock = vi.mocked(createAdmin);

const ADMIN = {
  userId: "admin-1",
  domainId: "IB10001",
  name: "Ivy Balandra",
  email: "ivy.balandra@example.invalid",
  role: "admin_support" as const,
  superAdmin: true,
};

const VALID = {
  fullName: "Ronald Japitana",
  email: "ronald.japitana@example.invalid",
  domainId: null,
  site: "iloilo",
  notify: true,
  superAdmin: false,
};

const post = (body: unknown) =>
  new Request("http://localhost:3000/api/admins", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admins", () => {
  it("401s when unauthenticated", async () => {
    requireAdminMock.mockResolvedValue(err("NOT_AUTHENTICATED"));
    expect((await GET()).status).toBe(401);
    expect(isSuperAdminMock).not.toHaveBeenCalled();
  });

  it("403s a role that is not admin_support, before touching the database", async () => {
    requireAdminMock.mockResolvedValue(err("FORBIDDEN"));
    expect((await GET()).status).toBe(403);
    expect(isSuperAdminMock).not.toHaveBeenCalled();
  });

  it("403s a plain admin_support user the DATABASE does not list as a holder — the list itself names who holds admin", async () => {
    requireAdminMock.mockResolvedValue(ok(ADMIN));
    isSuperAdminMock.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  // The GRANT direction. The session flag is baked in at login and lags a
  // fresh grant by up to the cookie's lifetime; gating on it handed the new
  // holder the tab (`roster/page.tsx` reads the database) and a 403 on every
  // write behind it. The database is the only authority, both ways.
  it("admits a holder whose session cookie predates the grant", async () => {
    requireAdminMock.mockResolvedValue(ok({ ...ADMIN, superAdmin: false }));
    isSuperAdminMock.mockResolvedValue(true);
    listMock.mockResolvedValue([]);
    expect((await GET()).status).toBe(200);
  });

  it("returns the whitelist to a verified whitelist manager", async () => {
    requireAdminMock.mockResolvedValue(ok(ADMIN));
    isSuperAdminMock.mockResolvedValue(true);
    listMock.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});

describe("POST /api/admins", () => {
  it("rejects an admin whose session says superAdmin but the DATABASE says no", async () => {
    // The whole reason the handler re-reads. A demoted holder keeps a valid
    // signed cookie claiming the capability until they happen to log out.
    requireAdminMock.mockResolvedValue({
      ok: true,
      value: { ...ADMIN, superAdmin: true },
    });
    isSuperAdminMock.mockResolvedValue(false);

    const res = await POST(post(VALID));
    expect(res.status).toBe(403);
    expect(createAdminMock).not.toHaveBeenCalled();
  });

  it("checks the database with the FULL identity, not just the Domain ID", async () => {
    // `isSuperAdmin` resolves through the same matcher as login — Domain ID
    // first, email fallback. Handing it only the Domain ID would make a holder
    // whose row is matched by email invisible, which is how a lockout got in.
    requireAdminMock.mockResolvedValue({
      ok: true,
      value: { ...ADMIN, superAdmin: true },
    });
    isSuperAdminMock.mockResolvedValue(true);
    createAdminMock.mockResolvedValue({
      ok: true,
      value: { id: "a1" },
    } as never);

    await POST(post(VALID));
    expect(isSuperAdminMock.mock.calls[0][1]).toEqual({
      domainId: ADMIN.domainId,
      email: ADMIN.email,
    });
  });

  it("rejects a role that is not admin_support", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, error: "FORBIDDEN" });
    const res = await POST(post(VALID));
    expect(res.status).toBe(403);
    expect(isSuperAdminMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload with 422 and does not write", async () => {
    requireAdminMock.mockResolvedValue(ok(ADMIN));
    isSuperAdminMock.mockResolvedValue(true);
    const res = await POST(post({ ...VALID, site: "everywhere" }));
    expect(res.status).toBe(422);
    expect(createAdminMock).not.toHaveBeenCalled();
  });

  it("passes the session's identity as the actor, not anything from the body", async () => {
    requireAdminMock.mockResolvedValue(ok(ADMIN));
    isSuperAdminMock.mockResolvedValue(true);
    createAdminMock.mockResolvedValue(ok({ id: "a1" }) as never);

    await POST(post({ ...VALID, actor: { name: "Somebody Else" } }));

    expect(createAdminMock.mock.calls[0][2]).toEqual({
      userId: "admin-1",
      domainId: "IB10001",
      email: "ivy.balandra@example.invalid",
      name: "Ivy Balandra",
      role: "admin_support",
    });
  });

  it("surfaces the repo's field on a refusal, so the form can attach it", async () => {
    requireAdminMock.mockResolvedValue(ok(ADMIN));
    isSuperAdminMock.mockResolvedValue(true);
    createAdminMock.mockResolvedValue(
      err({ code: "VALIDATION_FAILED", message: "Taken.", field: "email" }),
    );

    const res = await POST(post(VALID));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.details).toEqual({ field: "email" });
  });
});
