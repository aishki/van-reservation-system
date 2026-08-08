import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";

// `after()` throws outside a request scope, which a unit test is. Mocked to a
// no-op: these tests are about the handler's own logic, not Next's
// post-response machinery. The dispatch it schedules is covered by
// dispatch.int.test.ts.
vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/modules/auth/service", () => ({ requireUser: vi.fn() }));
vi.mock("@/modules/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/reservations/write", () => ({ cancelReservation: vi.fn() }));

import { requireUser } from "@/modules/auth/service";
import { cancelReservation } from "@/modules/reservations/write";
import { POST } from "./route";

const requireUserMock = vi.mocked(requireUser);
const cancelMock = vi.mocked(cancelReservation);

const associate = {
  userId: "user-1",
  domainId: "AJ29104",
  name: "Arielle Jimera",
  email: "arielle.jimera@carelon.com",
  role: "associate" as const,
  superAdmin: false,
};

function cancel(id: string, body?: unknown) {
  return [
    new Request(`http://localhost/api/reservations/${id}/cancel`, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id }) },
  ] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/reservations/[id]/cancel", () => {
  it("401s when unauthenticated", async () => {
    requireUserMock.mockResolvedValue(err("NOT_AUTHENTICATED"));
    const [req, ctx] = cancel("VR-2026-000001");
    expect((await POST(req, ctx)).status).toBe(401);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("204s an empty body — the confirm dialog collects no reason", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    cancelMock.mockResolvedValue(ok(null));

    const [req, ctx] = cancel("VR-2026-000001");
    const response = await POST(req, ctx);

    expect(response.status).toBe(204);
    expect(cancelMock).toHaveBeenCalledWith(
      expect.anything(),
      associate,
      "VR-2026-000001",
      "",
    );
  });

  it("forwards a reason when one is given", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    cancelMock.mockResolvedValue(ok(null));

    const [req, ctx] = cancel("VR-2026-000001", { reason: "Meeting moved." });
    await POST(req, ctx);

    expect(cancelMock).toHaveBeenCalledWith(
      expect.anything(),
      associate,
      "VR-2026-000001",
      "Meeting moved.",
    );
  });

  it("404s a reference the caller may not cancel", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    cancelMock.mockResolvedValue(
      err({ code: "NOT_FOUND" as const, message: "Reservation not found." }),
    );
    const [req, ctx] = cancel("VR-2026-999999");
    expect((await POST(req, ctx)).status).toBe(404);
  });

  it("409s a request that is no longer pending", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    cancelMock.mockResolvedValue(
      err({ code: "INVALID_TRANSITION" as const, message: "Not pending." }),
    );
    const [req, ctx] = cancel("VR-2026-000001");
    expect((await POST(req, ctx)).status).toBe(409);
  });
});
