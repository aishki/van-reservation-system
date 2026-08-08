import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import type { ReservationDetail } from "@/modules/reservations/types";

// `after()` throws outside a request scope, which a unit test is. Mocked to a
// no-op: these tests are about the handler's own logic, not Next's
// post-response machinery. The dispatch it schedules is covered by
// dispatch.int.test.ts.
vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/modules/auth/service", () => ({
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
}));
vi.mock("@/modules/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/reservations/repo", () => ({
  getReservationDetail: vi.fn(),
}));
vi.mock("@/modules/reservations/write", () => ({ decideReservation: vi.fn() }));

import { requireAdmin, requireUser } from "@/modules/auth/service";
import { getReservationDetail } from "@/modules/reservations/repo";
import { decideReservation } from "@/modules/reservations/write";
import { GET, PATCH } from "./route";

const requireUserMock = vi.mocked(requireUser);
const requireAdminMock = vi.mocked(requireAdmin);
const detailMock = vi.mocked(getReservationDetail);
const decideMock = vi.mocked(decideReservation);

const associate = {
  userId: "user-1",
  domainId: "AJ29104",
  name: "Arielle Jimera",
  email: "arielle.jimera@carelon.com",
  role: "associate" as const,
  superAdmin: false,
};

const found = {
  requestorUserId: "user-1",
  detail: { id: "VR-2026-000001" } as ReservationDetail,
};

function request(id: string) {
  return [
    new Request(`http://localhost/api/reservations/${id}`),
    { params: Promise.resolve({ id }) },
  ] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reservations/[id]", () => {
  it("401s when unauthenticated", async () => {
    requireUserMock.mockResolvedValue(err("NOT_AUTHENTICATED"));
    const [req, ctx] = request("VR-2026-000001");
    expect((await GET(req, ctx)).status).toBe(401);
  });

  it("404s for an unknown reference", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    detailMock.mockResolvedValue(null);
    const [req, ctx] = request("VR-2026-999999");
    expect((await GET(req, ctx)).status).toBe(404);
  });

  it("404s for a non-owner associate with the SAME body as a real miss", async () => {
    requireUserMock.mockResolvedValue(ok({ ...associate, userId: "user-2" }));
    detailMock.mockResolvedValue(found);
    const [req, ctx] = request("VR-2026-000001");
    const notOwner = await GET(req, ctx);
    expect(notOwner.status).toBe(404);

    detailMock.mockResolvedValue(null);
    const [req2, ctx2] = request("VR-2026-000001");
    const missing = await GET(req2, ctx2);
    expect(await notOwner.json()).toEqual(await missing.json());
  });

  it("returns the detail to the owner", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    detailMock.mockResolvedValue(found);
    const [req, ctx] = request("VR-2026-000001");
    const response = await GET(req, ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "VR-2026-000001" });
  });

  it("returns the detail to an admin who is not the owner", async () => {
    requireUserMock.mockResolvedValue(
      ok({ ...associate, userId: "user-9", role: "admin_support" as const }),
    );
    detailMock.mockResolvedValue(found);
    const [req, ctx] = request("VR-2026-000001");
    expect((await GET(req, ctx)).status).toBe(200);
  });
});

const admin = {
  ...associate,
  userId: "admin-1",
  role: "admin_support" as const,
};

const approval = {
  version: 3,
  decision: "approve" as const,
  rejectionReason: "",
  driver: {
    source: "roster" as const,
    driverId: "8ba7f3d0-1c2b-4a5e-9f60-2d1e3c4b5a60",
  },
  van: {
    source: "roster" as const,
    vanId: "2c1d4e5f-6a7b-4c8d-9e01-2f3a4b5c6d70",
  },
  trip: null,
};

function patch(id: string, body: unknown) {
  return [
    new Request(`http://localhost/api/reservations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ] as const;
}

describe("PATCH /api/reservations/[id]", () => {
  it("401s when unauthenticated", async () => {
    requireAdminMock.mockResolvedValue(err("NOT_AUTHENTICATED"));
    const [req, ctx] = patch("VR-2026-000001", approval);
    expect((await PATCH(req, ctx)).status).toBe(401);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("403s an associate — deciding is admin-only", async () => {
    requireAdminMock.mockResolvedValue(err("FORBIDDEN"));
    const [req, ctx] = patch("VR-2026-000001", approval);
    expect((await PATCH(req, ctx)).status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("422s a body with no version, so a blind write cannot skip the guard", async () => {
    requireAdminMock.mockResolvedValue(ok(admin));
    const [req, ctx] = patch("VR-2026-000001", {
      decision: "approve",
      driver: null,
      van: null,
      trip: null,
    });
    expect((await PATCH(req, ctx)).status).toBe(422);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("forwards the decision and returns the new status and version", async () => {
    requireAdminMock.mockResolvedValue(ok(admin));
    decideMock.mockResolvedValue(
      ok({ reference: "VR-2026-000001", status: "approved", version: 4 }),
    );

    const [req, ctx] = patch("VR-2026-000001", approval);
    const response = await PATCH(req, ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reference: "VR-2026-000001",
      status: "approved",
      version: 4,
    });
    expect(decideMock).toHaveBeenCalledWith(
      expect.anything(),
      admin,
      "VR-2026-000001",
      expect.objectContaining({ version: 3, decision: "approve" }),
    );
  });

  it("409s a stale version", async () => {
    requireAdminMock.mockResolvedValue(ok(admin));
    decideMock.mockResolvedValue(
      err({ code: "VERSION_CONFLICT" as const, message: "Reload and retry." }),
    );
    const [req, ctx] = patch("VR-2026-000001", approval);
    expect((await PATCH(req, ctx)).status).toBe(409);
  });

  it("409s a decision on a request that is no longer pending", async () => {
    requireAdminMock.mockResolvedValue(ok(admin));
    decideMock.mockResolvedValue(
      err({ code: "INVALID_TRANSITION" as const, message: "Not pending." }),
    );
    const [req, ctx] = patch("VR-2026-000001", approval);
    expect((await PATCH(req, ctx)).status).toBe(409);
  });

  it("passes field errors through so the drawer can paint them", async () => {
    requireAdminMock.mockResolvedValue(ok(admin));
    decideMock.mockResolvedValue(
      err({
        code: "VALIDATION_FAILED" as const,
        message: "This decision is missing a required field.",
        details: {
          driverName: "Assign a driver before approving this request.",
          van: "Assign a van before approving this request.",
        },
      }),
    );
    const [req, ctx] = patch("VR-2026-000001", {
      ...approval,
      driver: null,
      van: null,
    });
    const response = await PATCH(req, ctx);
    expect(response.status).toBe(422);
    expect((await response.json()).error.details).toEqual({
      driverName: "Assign a driver before approving this request.",
      van: "Assign a van before approving this request.",
    });
  });
});
