import { beforeEach, describe, expect, it, vi } from "vitest";

// `env()` validates the WHOLE environment, which a unit test does not populate,
// so it is mocked rather than having every test file carry a full .env.
vi.mock("@/lib/env", () => ({ env: vi.fn() }));
vi.mock("@/modules/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/email/dispatch", () => ({ dispatchOutbox: vi.fn() }));
vi.mock("@/modules/email/select-transport", () => ({
  selectMailTransport: vi.fn(() => ({ send: vi.fn() })),
}));

import { env } from "@/lib/env";
import { dispatchOutbox } from "@/modules/email/dispatch";
import { selectMailTransport } from "@/modules/email/select-transport";
import { GET } from "./route";

const envMock = vi.mocked(env);
const dispatchMock = vi.mocked(dispatchOutbox);
const transportMock = vi.mocked(selectMailTransport);

const SECRET = "a-sufficiently-long-secret";

const request = (secret?: string) =>
  new Request("http://localhost:3000/api/internal/dispatch-outbox", {
    headers: secret === undefined ? {} : { "x-dispatch-secret": secret },
  });

function envWith(secret: string | undefined) {
  // Only the field this route reads; the rest of the schema is irrelevant here.
  envMock.mockReturnValue({ DISPATCH_SECRET: secret } as ReturnType<
    typeof env
  >);
}

beforeEach(() => {
  vi.clearAllMocks();
  transportMock.mockReturnValue({ send: vi.fn() });
  envWith(SECRET);
});

describe("GET /api/internal/dispatch-outbox", () => {
  it("dispatches and returns the counts when the secret matches", async () => {
    dispatchMock.mockResolvedValue({ sent: 2, failed: 0, retrying: 1 });
    const response = await GET(request(SECRET));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 2, failed: 0, retrying: 1 });
  });

  it("401s a wrong secret without dispatching", async () => {
    const response = await GET(request("wrong"));
    expect(response.status).toBe(401);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("401s a missing header", async () => {
    expect((await GET(request())).status).toBe(401);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("404s when no secret is configured, so it cannot be left open", async () => {
    envWith(undefined);
    const response = await GET(request(SECRET));
    expect(response.status).toBe(404);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("reports zero rather than throwing when no transport is configured", async () => {
    transportMock.mockReturnValue(null);
    const response = await GET(request(SECRET));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 0, failed: 0, retrying: 0 });
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
