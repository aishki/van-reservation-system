import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";

vi.mock("@/modules/auth/service", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/modules/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/drivers/repo", () => ({
  listDrivers: vi.fn(),
  createDriver: vi.fn(),
}));

import { requireAdmin } from "@/modules/auth/service";
import { createDriver, listDrivers } from "@/modules/drivers/repo";
import { GET, POST } from "./route";

const requireAdminMock = vi.mocked(requireAdmin);
const listMock = vi.mocked(listDrivers);
const createDriverMock = vi.mocked(createDriver);

const ADMIN = ok({
  userId: "admin-1",
  domainId: "IB10001",
  name: "Ivy Balandra",
  email: "ivy.balandra@example.invalid",
  role: "admin_support" as const,
  superAdmin: false,
});

const VALID = {
  name: "Ronald Japitana",
  mobile: "09171234567",
  site: "Iloilo",
  shift: null,
};

const post = (body: unknown) =>
  new Request("http://localhost:3000/api/drivers", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/drivers", () => {
  it("401s when unauthenticated", async () => {
    requireAdminMock.mockResolvedValue(err("NOT_AUTHENTICATED"));
    expect((await GET()).status).toBe(401);
  });

  it("403s a non-admin", async () => {
    requireAdminMock.mockResolvedValue(err("FORBIDDEN"));
    expect((await GET()).status).toBe(403);
  });

  it("returns the roster to an admin", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    listMock.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});

describe("POST /api/drivers", () => {
  it("rejects a non-admin BEFORE parsing the body", async () => {
    requireAdminMock.mockResolvedValue(err("FORBIDDEN"));
    const res = await POST(post(VALID));
    expect(res.status).toBe(403);
    expect(createDriverMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload with 422 and does not write", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    const res = await POST(post({ ...VALID, site: "all" }));
    expect(res.status).toBe(422);
    expect(createDriverMock).not.toHaveBeenCalled();
  });

  it("passes the session's identity as the actor, not anything from the body", async () => {
    // Otherwise a client could forge who made the change in a permanent log.
    requireAdminMock.mockResolvedValue(ADMIN);
    createDriverMock.mockResolvedValue(ok({ id: "d1" }) as never);

    await POST(post({ ...VALID, actor: { name: "Somebody Else" } }));

    expect(createDriverMock.mock.calls[0][2]).toEqual({
      userId: "admin-1",
      domainId: "IB10001",
      email: "ivy.balandra@example.invalid",
      name: "Ivy Balandra",
      role: "admin_support",
    });
  });

  it("surfaces the repo's field on a refusal, so the form can attach it", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    createDriverMock.mockResolvedValue(
      err({ code: "VALIDATION_FAILED", message: "Taken.", field: "mobile" }),
    );

    const res = await POST(post(VALID));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.details).toEqual({ field: "mobile" });
  });
});
