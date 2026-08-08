import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import { blankDraft, blankTrip } from "@/modules/reservations/draft";

// `after()` throws outside a request scope, which a unit test is. Mocked to a
// no-op: these tests are about the handler's own logic, not Next's
// post-response machinery. The dispatch it schedules is covered by
// dispatch.int.test.ts.
vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/modules/auth/service", () => ({ requireUser: vi.fn() }));
vi.mock("@/modules/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/reservations/repo", () => ({ listReservations: vi.fn() }));
vi.mock("@/modules/reservations/write", () => ({ submitBooking: vi.fn() }));

import { requireUser } from "@/modules/auth/service";
import { listReservations } from "@/modules/reservations/repo";
import { submitBooking } from "@/modules/reservations/write";
import { GET, POST } from "./route";

const requireUserMock = vi.mocked(requireUser);
const listMock = vi.mocked(listReservations);
const submitMock = vi.mocked(submitBooking);

const associate = {
  userId: "user-1",
  domainId: "AJ29104",
  name: "Arielle Jimera",
  email: "arielle.jimera@carelon.com",
  role: "associate" as const,
  superAdmin: false,
};

/** A structurally complete pickup draft — shape only; the repo owns the rules. */
function pickupDraft() {
  return {
    ...blankDraft("pickup"),
    site: "Manila" as const,
    mobile: "09171112222",
    trips: [
      {
        ...blankTrip(),
        purpose: "Travel-Related (Airport Transfers)",
        passengers: [{ domainId: "AJ29104", name: "Jimera, Arielle" }],
        pickupDate: "2026-09-01",
        pickupTime: "06:30",
        pickupPoint: "GLS Tower lobby",
        dropoffPoint: "AGT Building",
      },
    ],
  };
}

function post(body: unknown) {
  return new Request("http://localhost/api/reservations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reservations", () => {
  it("401s when unauthenticated", async () => {
    requireUserMock.mockResolvedValue(err("NOT_AUTHENTICATED"));
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("scopes an associate to their own rows", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    listMock.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith(expect.anything(), {
      requestorUserId: "user-1",
    });
  });

  it("gives an admin every row", async () => {
    requireUserMock.mockResolvedValue(
      ok({ ...associate, role: "admin_support" as const }),
    );
    listMock.mockResolvedValue([]);
    await GET();
    expect(listMock).toHaveBeenCalledWith(expect.anything(), { all: true });
  });
});

describe("POST /api/reservations", () => {
  it("401s when unauthenticated, without touching the database", async () => {
    requireUserMock.mockResolvedValue(err("NOT_AUTHENTICATED"));
    const response = await POST(post(pickupDraft()));
    expect(response.status).toBe(401);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("422s a body that is not a booking draft", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    const response = await POST(post({ mode: "helicopter" }));
    expect(response.status).toBe(422);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("422s a malformed body rather than throwing", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    const response = await POST(
      new Request("http://localhost/api/reservations", {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(response.status).toBe(422);
  });

  it("takes the requestor from the session, never the body", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    submitMock.mockResolvedValue(ok(["VR-2026-000001"]));

    await POST(
      post({
        ...pickupDraft(),
        // A hand-rolled body claiming to be someone else. The schema drops it,
        // and the handler passes the session user regardless.
        requestorUserId: "user-9",
        requestorName: "Somebody Else",
      }),
    );

    expect(submitMock).toHaveBeenCalledWith(
      expect.anything(),
      associate,
      expect.objectContaining({ mode: "pickup", site: "Manila" }),
      expect.any(Date),
    );
  });

  it("201s with every reference the submission created", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    submitMock.mockResolvedValue(ok(["VR-2026-000001", "VR-2026-000002"]));

    const response = await POST(post(pickupDraft()));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.references).toEqual(["VR-2026-000001", "VR-2026-000002"]);
    expect(Number.isNaN(Date.parse(body.submittedAt))).toBe(false);
  });

  it("passes a repo refusal through with its code and field details", async () => {
    requireUserMock.mockResolvedValue(ok(associate));
    submitMock.mockResolvedValue(
      err({
        code: "VALIDATION_FAILED" as const,
        message: "Some details are missing or invalid.",
        details: { site: "Choose a site before continuing." },
      }),
    );

    const response = await POST(post(pickupDraft()));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "Some details are missing or invalid.",
        details: { site: "Choose a site before continuing." },
      },
    });
  });
});
