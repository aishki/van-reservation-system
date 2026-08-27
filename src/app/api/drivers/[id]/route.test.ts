import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";

vi.mock("@/modules/auth/service", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/modules/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/drivers/repo", () => ({
  updateDriver: vi.fn(),
  setDriverActive: vi.fn(),
}));

import { requireAdmin } from "@/modules/auth/service";
import { setDriverActive, updateDriver } from "@/modules/drivers/repo";
import { PATCH } from "./route";

const requireAdminMock = vi.mocked(requireAdmin);
const updateDriverMock = vi.mocked(updateDriver);
const setDriverActiveMock = vi.mocked(setDriverActive);

const ADMIN = ok({
  userId: "admin-1",
  domainId: "IB10001",
  name: "Ivy Balandra",
  email: "ivy.balandra@example.invalid",
  role: "admin_support" as const,
  superAdmin: false,
});

const ACTOR = {
  userId: "admin-1",
  domainId: "IB10001",
  email: "ivy.balandra@example.invalid",
  name: "Ivy Balandra",
  role: "admin_support",
};

const patch = (body: unknown) =>
  new Request("http://localhost:3000/api/drivers/d1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const call = (body: unknown) =>
  PATCH(patch(body), { params: Promise.resolve({ id: "d1" }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/drivers/[id]", () => {
  it("rejects a non-admin BEFORE parsing the body", async () => {
    requireAdminMock.mockResolvedValue(err("FORBIDDEN"));
    const res = await call({ mobile: "09990001111" });
    expect(res.status).toBe(403);
    expect(updateDriverMock).not.toHaveBeenCalled();
    expect(setDriverActiveMock).not.toHaveBeenCalled();
  });

  it("rejects an empty patch with 422 and does not write", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    const res = await call({});
    expect(res.status).toBe(422);
    expect(updateDriverMock).not.toHaveBeenCalled();
    expect(setDriverActiveMock).not.toHaveBeenCalled();
  });

  it("rejects a body mixing activation with a field change", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    const res = await call({ active: false, mobile: "09990001111" });
    expect(res.status).toBe(422);
    expect(updateDriverMock).not.toHaveBeenCalled();
    expect(setDriverActiveMock).not.toHaveBeenCalled();
  });

  it("routes a bare activation change to setDriverActive, not updateDriver", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    setDriverActiveMock.mockResolvedValue(ok({ id: "d1" }) as never);

    await call({ active: false });

    expect(setDriverActiveMock).toHaveBeenCalledWith({}, "d1", false, ACTOR);
    expect(updateDriverMock).not.toHaveBeenCalled();
  });

  it("routes a field patch to updateDriver, not setDriverActive", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    updateDriverMock.mockResolvedValue(ok({ id: "d1" }) as never);

    await call({ mobile: "09990001111" });

    expect(updateDriverMock).toHaveBeenCalledWith(
      {},
      "d1",
      { mobile: "09990001111" },
      ACTOR,
    );
    expect(setDriverActiveMock).not.toHaveBeenCalled();
  });

  it("maps a NOT_FOUND from the repo to 404", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    updateDriverMock.mockResolvedValue(
      err({
        code: "NOT_FOUND",
        message: "That roster entry no longer exists.",
      }),
    );

    const res = await call({ mobile: "09990001111" });
    expect(res.status).toBe(404);
  });
});
