import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";

vi.mock("@/modules/auth/service", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/modules/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/admins/repo", () => ({
  updateAdmin: vi.fn(),
  setAdminActive: vi.fn(),
  isSuperAdmin: vi.fn(),
}));

import {
  isSuperAdmin,
  setAdminActive,
  updateAdmin,
} from "@/modules/admins/repo";
import { requireAdmin } from "@/modules/auth/service";
import { PATCH } from "./route";

const requireAdminMock = vi.mocked(requireAdmin);
const isSuperAdminMock = vi.mocked(isSuperAdmin);
const updateAdminMock = vi.mocked(updateAdmin);
const setAdminActiveMock = vi.mocked(setAdminActive);

const ADMIN = ok({
  userId: "admin-1",
  domainId: "IB10001",
  name: "Ivy Balandra",
  email: "ivy.balandra@example.invalid",
  role: "admin_support" as const,
  superAdmin: true,
});

const ACTOR = {
  userId: "admin-1",
  domainId: "IB10001",
  email: "ivy.balandra@example.invalid",
  name: "Ivy Balandra",
  role: "admin_support",
};

const patch = (body: unknown) =>
  new Request("http://localhost:3000/api/admins/a1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const call = (body: unknown) =>
  PATCH(patch(body), { params: Promise.resolve({ id: "a1" }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/admins/[id]", () => {
  it("rejects a non-admin BEFORE parsing the body", async () => {
    requireAdminMock.mockResolvedValue(err("FORBIDDEN"));
    const res = await call({ notify: false });
    expect(res.status).toBe(403);
    expect(isSuperAdminMock).not.toHaveBeenCalled();
    expect(updateAdminMock).not.toHaveBeenCalled();
    expect(setAdminActiveMock).not.toHaveBeenCalled();
  });

  it("rejects an admin whose session says superAdmin but the DATABASE says no", async () => {
    // The whole reason the handler re-reads. A demoted holder keeps a valid
    // signed cookie claiming the capability until they happen to log out.
    requireAdminMock.mockResolvedValue(ADMIN);
    isSuperAdminMock.mockResolvedValue(false);
    const res = await call({ notify: false });
    expect(res.status).toBe(403);
    expect(updateAdminMock).not.toHaveBeenCalled();
    expect(setAdminActiveMock).not.toHaveBeenCalled();
  });

  it("checks the database with the FULL identity, not just the Domain ID", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    isSuperAdminMock.mockResolvedValue(true);
    updateAdminMock.mockResolvedValue(ok({ id: "a1" }) as never);

    await call({ notify: false });

    expect(isSuperAdminMock.mock.calls[0][1]).toEqual({
      domainId: "IB10001",
      email: "ivy.balandra@example.invalid",
    });
  });

  it("rejects an empty patch with 422 and does not write", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    isSuperAdminMock.mockResolvedValue(true);
    const res = await call({});
    expect(res.status).toBe(422);
    expect(updateAdminMock).not.toHaveBeenCalled();
    expect(setAdminActiveMock).not.toHaveBeenCalled();
  });

  it("rejects a body mixing activation with a field change", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    isSuperAdminMock.mockResolvedValue(true);
    const res = await call({ active: false, notify: false });
    expect(res.status).toBe(422);
    expect(updateAdminMock).not.toHaveBeenCalled();
    expect(setAdminActiveMock).not.toHaveBeenCalled();
  });

  it("routes a bare activation change to setAdminActive, not updateAdmin", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    isSuperAdminMock.mockResolvedValue(true);
    setAdminActiveMock.mockResolvedValue(ok({ id: "a1" }) as never);

    await call({ active: false });

    expect(setAdminActiveMock).toHaveBeenCalledWith({}, "a1", false, ACTOR);
    expect(updateAdminMock).not.toHaveBeenCalled();
  });

  it("routes a field patch to updateAdmin, not setAdminActive", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    isSuperAdminMock.mockResolvedValue(true);
    updateAdminMock.mockResolvedValue(ok({ id: "a1" }) as never);

    await call({ notify: false });

    expect(updateAdminMock).toHaveBeenCalledWith(
      {},
      "a1",
      { notify: false },
      ACTOR,
    );
    expect(setAdminActiveMock).not.toHaveBeenCalled();
  });

  it("maps a NOT_FOUND from the repo to 404", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    isSuperAdminMock.mockResolvedValue(true);
    updateAdminMock.mockResolvedValue(
      err({
        code: "NOT_FOUND",
        message: "That roster entry no longer exists.",
      }),
    );

    const res = await call({ notify: false });
    expect(res.status).toBe(404);
  });
});
