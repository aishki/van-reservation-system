import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";

vi.mock("@/modules/auth/service", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/modules/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/vans/repo", () => ({
  updateVan: vi.fn(),
  setVanActive: vi.fn(),
}));

import { requireAdmin } from "@/modules/auth/service";
import { setVanActive, updateVan } from "@/modules/vans/repo";
import { PATCH } from "./route";

const requireAdminMock = vi.mocked(requireAdmin);
const updateVanMock = vi.mocked(updateVan);
const setVanActiveMock = vi.mocked(setVanActive);

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
  new Request("http://localhost:3000/api/vans/v1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const call = (body: unknown) =>
  PATCH(patch(body), { params: Promise.resolve({ id: "v1" }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/vans/[id]", () => {
  it("rejects a non-admin BEFORE parsing the body", async () => {
    requireAdminMock.mockResolvedValue(err("FORBIDDEN"));
    const res = await call({ plate: "ABC 1234" });
    expect(res.status).toBe(403);
    expect(updateVanMock).not.toHaveBeenCalled();
    expect(setVanActiveMock).not.toHaveBeenCalled();
  });

  it("rejects an empty patch with 422 and does not write", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    const res = await call({});
    expect(res.status).toBe(422);
    expect(updateVanMock).not.toHaveBeenCalled();
    expect(setVanActiveMock).not.toHaveBeenCalled();
  });

  it("rejects a body mixing activation with a field change", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    const res = await call({ active: false, plate: "ABC 1234" });
    expect(res.status).toBe(422);
    expect(updateVanMock).not.toHaveBeenCalled();
    expect(setVanActiveMock).not.toHaveBeenCalled();
  });

  it("routes a bare activation change to setVanActive, not updateVan", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    setVanActiveMock.mockResolvedValue(ok({ id: "v1" }) as never);

    await call({ active: false });

    expect(setVanActiveMock).toHaveBeenCalledWith({}, "v1", false, ACTOR);
    expect(updateVanMock).not.toHaveBeenCalled();
  });

  it("routes a field patch to updateVan, not setVanActive", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    updateVanMock.mockResolvedValue(ok({ id: "v1" }) as never);

    await call({ plate: "ABC 1234" });

    expect(updateVanMock).toHaveBeenCalledWith(
      {},
      "v1",
      { plate: "ABC 1234" },
      ACTOR,
    );
    expect(setVanActiveMock).not.toHaveBeenCalled();
  });

  it("maps a NOT_FOUND from the repo to 404", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    updateVanMock.mockResolvedValue(
      err({
        code: "NOT_FOUND",
        message: "That roster entry no longer exists.",
      }),
    );

    const res = await call({ plate: "ABC 1234" });
    expect(res.status).toBe(404);
  });
});
