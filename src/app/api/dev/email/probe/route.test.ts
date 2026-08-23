import { afterEach, describe, expect, it, vi } from "vitest";

// `env()` validates the WHOLE environment, which a unit test does not populate,
// so it is mocked rather than having this file carry a full .env.
const sendEmailMock = vi.fn();
const selectMailTransportMock = vi.fn();
const envMock = vi.fn();

vi.mock("@/lib/env", () => ({ env: () => envMock() }));
vi.mock("@/modules/email/service", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));
vi.mock("@/modules/email/select-transport", () => ({
  selectMailTransport: (...args: unknown[]) => selectMailTransportMock(...args),
}));

const { GET } = await import("@/app/api/dev/email/probe/route");

/** Only the fields this route reads; the rest of the schema is irrelevant. */
function envWith(overrides: Record<string, unknown> = {}) {
  envMock.mockReturnValue({ EMAIL_MODE: "ses", ...overrides });
}

const request = (query: string) =>
  new Request(`http://localhost:3000/api/dev/email/probe${query}`);

afterEach(() => {
  vi.unstubAllEnvs();
  sendEmailMock.mockReset();
  selectMailTransportMock.mockReset();
  envMock.mockReset();
});

describe("GET /api/dev/email/probe", () => {
  it("is absent in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await GET(request("?to=a@example.com"))).status).toBe(404);
    // The guard must run BEFORE anything is sent, not merely change the reply.
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("refuses without a recipient rather than picking one", async () => {
    // It sends real mail; a default recipient would be somebody's inbox.
    const res = await GET(request(""));
    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("returns the provider's own error detail, not just the code", async () => {
    envWith();
    selectMailTransportMock.mockReturnValue({ send: vi.fn() });
    sendEmailMock.mockResolvedValue({
      ok: false,
      error: {
        code: "EMAIL_REJECTED",
        detail: "UnrecognizedClientException — bad token — HTTP 403",
      },
    });

    const res = await GET(request("?to=a@example.com"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("EMAIL_REJECTED");
    expect(body.detail).toContain("UnrecognizedClientException");
  });

  it("reports the key PREFIX and never the key", async () => {
    envWith({
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "ASIA_NOT_A_REAL_KEY_ID",
      AWS_SECRET_ACCESS_KEY: "secret-example",
      EMAIL_FROM: "Van Reservation <no-reply@example.com>",
    });
    selectMailTransportMock.mockReturnValue({ send: vi.fn() });
    sendEmailMock.mockResolvedValue({ ok: true, value: { id: "ses-1" } });

    const body = await (await GET(request("?to=a@example.com"))).json();
    // ASIA is the tell for temporary credentials, which need a session token.
    expect(body.configured.credentials.keyPrefix).toBe("ASIA");
    expect(body.configured.credentials.sessionToken).toBe("absent");
    expect(JSON.stringify(body)).not.toContain("NOT_A_REAL_KEY_ID");
    expect(JSON.stringify(body)).not.toContain("secret-example");
  });
});
