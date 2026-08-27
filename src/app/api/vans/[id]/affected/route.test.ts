import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";

vi.mock("@/modules/auth/service", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/modules/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/tz", () => ({ todayInManila: () => "2026-09-01" }));
vi.mock("@/modules/roster/conflicts", () => ({ affectedTrips: vi.fn() }));

import { requireAdmin } from "@/modules/auth/service";
import { affectedTrips } from "@/modules/roster/conflicts";
import { GET } from "./route";

const requireAdminMock = vi.mocked(requireAdmin);
const affectedTripsMock = vi.mocked(affectedTrips);

const ADMIN = ok({
  userId: "admin-1",
  domainId: "IB10001",
  name: "Ivy Balandra",
  email: "ivy.balandra@example.invalid",
  role: "admin_support" as const,
  superAdmin: false,
});

const call = () =>
  GET(new Request("http://localhost:3000/api/vans/v1/affected"), {
    params: Promise.resolve({ id: "v1" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/vans/[id]/affected", () => {
  it("rejects a non-admin before touching the database", async () => {
    requireAdminMock.mockResolvedValue(err("FORBIDDEN"));
    const res = await call();
    expect(res.status).toBe(403);
    expect(affectedTripsMock).not.toHaveBeenCalled();
  });

  it("asks affectedTrips for this van, with the server's own today", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    affectedTripsMock.mockResolvedValue([
      {
        reference: "VR-2026-000159",
        startDate: "2026-09-10",
        requestor: "Juan Cruz",
      },
    ]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(affectedTripsMock).toHaveBeenCalledWith(
      expect.anything(),
      "van",
      "v1",
      "2026-09-01",
    );
    expect(await res.json()).toEqual([
      {
        reference: "VR-2026-000159",
        startDate: "2026-09-10",
        requestor: "Juan Cruz",
      },
    ]);
  });
});
