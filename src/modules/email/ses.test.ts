import { describe, expect, it, vi } from "vitest";
import {
  type SesSend,
  SesTransport,
  sesClientConfig,
} from "@/modules/email/ses";
import type {
  EmailError,
  EmailFailure,
  EmailMessage,
} from "@/modules/email/transport";

const baseConfig = {
  region: "ap-southeast-1",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "secret",
  from: "Van Reservation <no-reply@example.com>",
};

const message: EmailMessage = {
  to: "juan@example.com",
  subject: "Van booking VR-1 — Approved",
  html: "<p>hello</p>",
  text: "hello",
};

const transportWith = (send: SesSend) =>
  new SesTransport({ ...baseConfig, sendCommand: send });

// SES throws exceptions carrying `.name` and `$metadata.httpStatusCode`; the
// classifier reads both, so a bare object reproduces the relevant shape.
const sesError = (name?: string, httpStatusCode?: number): SesSend => {
  return async () => {
    throw { name, $metadata: { httpStatusCode } };
  };
};

/** The transport's failure. Fails loudly if the send unexpectedly succeeded. */
async function failureOf(send: SesSend): Promise<EmailError> {
  const result = await transportWith(send).send(message);
  if (result.ok) throw new Error("expected this send to fail");
  return result.error;
}

describe("SesTransport", () => {
  it("sends and returns the SES MessageId", async () => {
    const send = vi.fn<SesSend>().mockResolvedValue({ MessageId: "msg-123" });
    await expect(transportWith(send).send(message)).resolves.toEqual({
      ok: true,
      value: { id: "msg-123" },
    });
  });

  it("passes the verified From, recipients, and both bodies to SES", async () => {
    const send = vi.fn<SesSend>().mockResolvedValue({ MessageId: "x" });
    await new SesTransport({
      ...baseConfig,
      replyTo: "ops@example.com",
      sendCommand: send,
    }).send({ ...message, to: ["a@example.com", "b@example.com"] });

    const input = send.mock.calls[0][0];
    expect(input.FromEmailAddress).toBe(baseConfig.from);
    expect(input.Destination?.ToAddresses).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(input.ReplyToAddresses).toEqual(["ops@example.com"]);
    expect(input.Content?.Simple?.Subject?.Data).toBe(message.subject);
    expect(input.Content?.Simple?.Body?.Html?.Data).toBe(message.html);
    expect(input.Content?.Simple?.Body?.Text?.Data).toBe(message.text);
  });

  it("prefers a message's own replyTo over the transport default", async () => {
    const send = vi.fn<SesSend>().mockResolvedValue({ MessageId: "x" });
    await new SesTransport({
      ...baseConfig,
      replyTo: "default@example.com",
      sendCommand: send,
    }).send({ ...message, replyTo: "override@example.com" });
    expect(send.mock.calls[0][0].ReplyToAddresses).toEqual([
      "override@example.com",
    ]);
  });

  it("omits ReplyToAddresses when neither message nor transport sets one", async () => {
    const send = vi.fn<SesSend>().mockResolvedValue({ MessageId: "x" });
    await transportWith(send).send(message);
    expect(send.mock.calls[0][0].ReplyToAddresses).toBeUndefined();
  });

  const cases: Array<[string, number | undefined, EmailFailure]> = [
    ["ThrottlingException", undefined, "RATE_LIMITED"],
    ["TooManyRequestsException", undefined, "RATE_LIMITED"],
    ["LimitExceededException", undefined, "RATE_LIMITED"],
    ["MessageRejected", undefined, "EMAIL_REJECTED"],
    ["MailFromDomainNotVerifiedException", undefined, "EMAIL_REJECTED"],
    ["AccountSuspendedException", undefined, "EMAIL_REJECTED"],
    ["SendingPausedException", undefined, "EMAIL_REJECTED"],
    ["InternalServiceException", 500, "SERVICE_UNAVAILABLE"],
    // Credential and permission failures. Every one of these arrives as 403 and
    // was classified SERVICE_UNAVAILABLE — so a wrong key was retried for hours
    // and finally reported as "the provider was unreachable". No retry fixes a
    // credential, so each is permanent.
    ["AccessDeniedException", 403, "EMAIL_REJECTED"],
    ["UnrecognizedClientException", 403, "EMAIL_REJECTED"],
    ["InvalidClientTokenId", 403, "EMAIL_REJECTED"],
    ["SignatureDoesNotMatch", 403, "EMAIL_REJECTED"],
    ["ExpiredTokenException", 403, "EMAIL_REJECTED"],
  ];

  it.each(cases)("maps the %s error to %s", async (name, status, expected) => {
    expect((await failureOf(sesError(name, status))).code).toBe(expected);
  });

  it("falls back to the HTTP status for an unnamed error (429 → RATE_LIMITED, 400/403 → EMAIL_REJECTED)", async () => {
    expect((await failureOf(sesError(undefined, 429))).code).toBe(
      "RATE_LIMITED",
    );
    expect((await failureOf(sesError(undefined, 400))).code).toBe(
      "EMAIL_REJECTED",
    );
    // 403 is the credential/permission answer. Classified transient it spends
    // MAX_ATTEMPTS of backoff before reporting a misconfiguration as an outage.
    expect((await failureOf(sesError(undefined, 403))).code).toBe(
      "EMAIL_REJECTED",
    );
  });

  it("treats a network error (no name, no status) as SERVICE_UNAVAILABLE", async () => {
    const send: SesSend = async () => {
      throw new Error("ECONNRESET");
    };
    expect((await failureOf(send)).code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("SesTransport cc", () => {
  it("passes copied recipients to SES as CcAddresses", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ MessageId: "ses-1" });
    await new SesTransport({ ...baseConfig, sendCommand }).send({
      ...message,
      cc: ["ivy@example.com", "ruwi@example.com"],
    });

    expect(sendCommand.mock.calls[0][0].Destination).toEqual({
      ToAddresses: ["juan@example.com"],
      CcAddresses: ["ivy@example.com", "ruwi@example.com"],
    });
  });

  it("omits CcAddresses entirely rather than sending an empty header", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ MessageId: "ses-1" });
    await new SesTransport({ ...baseConfig, sendCommand }).send({
      ...message,
      cc: [],
    });

    expect(sendCommand.mock.calls[0][0].Destination).toEqual({
      ToAddresses: ["juan@example.com"],
    });
  });
});

/**
 * The credential decision, tested through `sesClientConfig` rather than through
 * a constructed `SESv2Client` — the SDK resolves credentials lazily into a
 * provider function, so the literal that was handed in is not readable off the
 * built client. This is the shape that goes to AWS.
 */
describe("sesClientConfig", () => {
  const keys = {
    region: "us-east-1",
    from: "Van Reservation <no-reply@example.com>",
    accessKeyId: "ASIA_TEMPORARY",
    secretAccessKey: "secret",
  };

  it("carries the session token for temporary credentials", () => {
    // Dropping this was a real outage: SSO keys start ASIA and are rejected 403
    // on every call without their token, so mail queued and never sent.
    expect(
      sesClientConfig({ ...keys, sessionToken: "token-abc" }).credentials,
    ).toEqual({
      accessKeyId: "ASIA_TEMPORARY",
      secretAccessKey: "secret",
      sessionToken: "token-abc",
    });
  });

  it("omits the session token for a permanent key rather than sending undefined", () => {
    const credentials = sesClientConfig({
      ...keys,
      accessKeyId: "AKIA_PERMANENT",
    }).credentials;
    expect(credentials).toEqual({
      accessKeyId: "AKIA_PERMANENT",
      secretAccessKey: "secret",
    });
    expect("sessionToken" in (credentials ?? {})).toBe(false);
  });

  it("omits credentials ENTIRELY when no key is configured", () => {
    // Not `credentials: {}` — passing the property at all opts out of the SDK's
    // default chain, which is how an instance role or SSO profile is picked up.
    const config = sesClientConfig({
      region: "us-east-1",
      from: "Van Reservation <no-reply@example.com>",
    });
    expect(config).toEqual({ region: "us-east-1" });
    expect("credentials" in config).toBe(false);
  });

  it("falls back to the default chain when only one half of the pair is set", () => {
    // env.ts refuses this at boot; the transport must not authenticate as a
    // half-credential if some other caller builds one.
    expect(
      "credentials" in sesClientConfig({ ...keys, secretAccessKey: undefined }),
    ).toBe(false);
  });
});

describe("SesTransport failure detail", () => {
  it("preserves the SES exception name, message and status", async () => {
    // `EMAIL_REJECTED` alone cannot be acted on. The name is the difference
    // between an unverified sender, a bad key, and a throttle.
    const detail = (
      await failureOf(async () => {
        throw Object.assign(
          new Error("The security token included is invalid"),
          {
            name: "UnrecognizedClientException",
            $metadata: { httpStatusCode: 403 },
          },
        );
      })
    ).detail;

    expect(detail).toContain("UnrecognizedClientException");
    expect(detail).toContain("The security token included is invalid");
    expect(detail).toContain("HTTP 403");
  });

  it("leaves detail undefined when the provider said nothing usable", async () => {
    expect((await failureOf(sesError(undefined, undefined))).detail).toBe(
      undefined,
    );
  });
});
