import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";

vi.mock("@/modules/auth/service", () => ({ requireUser: vi.fn() }));
vi.mock("@/modules/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/reservations/repo", () => ({ getFieldHistory: vi.fn() }));

import { requireUser } from "@/modules/auth/service";
import { getFieldHistory } from "@/modules/reservations/repo";
import { GET } from "./route";

const requireUserMock = vi.mocked(requireUser);
const historyMock = vi.mocked(getFieldHistory);

const associate = {
  userId: "user-1",
  domainId: "AJ29104",
  name: "Arielle Jimera",
  email: "arielle.jimera@carelon.com",
  role: "associate" as const,
  superAdmin: false,
};

const emptyHistory = {
  pickupPoint: [],
  dropoffPoint: [],
  passengerName: [],
  passengerEmail: [],
  mobile: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reservations/field-history", () => {
  it("401s when unauthenticated, without querying the database", async () => {
    requireUserMock.mockResolvedValue(err("NOT_AUTHENTICATED"));
    const response = await GET();
    expect(response.status).toBe(401);
    expect(historyMock).not.toHaveBeenCalled();
  });

  it("always scopes to the caller's own userId, admin or not", async () => {
    requireUserMock.mockResolvedValue(
      ok({ ...associate, role: "admin_support" as const }),
    );
    historyMock.mockResolvedValue(emptyHistory);

    const response = await GET();

    expect(response.status).toBe(200);
    // No `{ all: true }` branch, unlike GET /api/reservations — this is a
    // personal autocomplete, never a management view, so an Admin Support
    // caller still only ever gets their OWN history back.
    expect(historyMock).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("returns exactly what the repo gives back", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    const history = {
      pickupPoint: ["GLS Tower lobby"],
      dropoffPoint: ["AGT Building"],
      passengerName: ["Dela Cruz, Juan"],
      passengerEmail: ["juan.delacruz@carelon.com"],
      mobile: ["09171234567"],
    };
    historyMock.mockResolvedValue(history);

    const response = await GET();

    expect(await response.json()).toEqual(history);
  });
});
