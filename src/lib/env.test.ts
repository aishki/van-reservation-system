import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const valid = {
  DATABASE_URL: "postgres://van:van@localhost:5433/van_reservation",
  SESSION_SECRET: "0123456789012345678901234567890123",
  AUTH_MODE: "stub",
  APP_URL: "http://localhost:3000",
} as unknown as NodeJS.ProcessEnv;

describe("parseEnv", () => {
  it("accepts a valid environment", () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.AUTH_MODE).toBe("stub");
  });

  it("throws when DATABASE_URL is missing", () => {
    // biome-ignore lint/correctness/noUnusedVariables: destructured only to exclude it from rest
    const { DATABASE_URL, ...rest } = valid;
    expect(() => parseEnv(rest as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  // An omitted AUTH_MODE must not silently select the stub provider, which
  // takes identity from the request body — see the comment in env.ts.
  it("throws when AUTH_MODE is missing", () => {
    // biome-ignore lint/correctness/noUnusedVariables: destructured only to exclude it from rest
    const { AUTH_MODE, ...rest } = valid;
    expect(() => parseEnv(rest as NodeJS.ProcessEnv)).toThrow(/AUTH_MODE/);
  });

  it("rejects a session secret shorter than 32 characters", () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: "too-short" })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("rejects an unknown AUTH_MODE", () => {
    expect(() => parseEnv({ ...valid, AUTH_MODE: "magic" })).toThrow(
      /AUTH_MODE/,
    );
  });

  it("defaults CGS_AUTH_BASE_URL to production when absent", () => {
    expect(parseEnv(valid).CGS_AUTH_BASE_URL).toBe("https://teamcgs.io");
  });

  // Fail closed: cgsauth without a key would 401 every login indistinguishably
  // from a bad password, so the app must refuse to boot rather than run blind.
  it("requires CGS_AUTH_API_KEY when AUTH_MODE=cgsauth", () => {
    expect(() => parseEnv({ ...valid, AUTH_MODE: "cgsauth" })).toThrow(
      /CGS_AUTH_API_KEY/,
    );
  });

  it("accepts cgsauth once a key is supplied", () => {
    const env = parseEnv({
      ...valid,
      AUTH_MODE: "cgsauth",
      CGS_AUTH_API_KEY: "live-key",
      CGS_AUTH_BASE_URL: "https://uat.teamcgs.io",
    });
    expect(env.AUTH_MODE).toBe("cgsauth");
    expect(env.CGS_AUTH_BASE_URL).toBe("https://uat.teamcgs.io");
  });

  it("does not require CGS_AUTH_API_KEY in stub mode", () => {
    expect(() => parseEnv(valid)).not.toThrow();
  });

  // Email transport. Defaults to `stub`, which the transport itself refuses to
  // construct in production — so an omitted EMAIL_MODE is safe (loud, not silent).
  it("defaults EMAIL_MODE to stub when absent", () => {
    expect(parseEnv(valid).EMAIL_MODE).toBe("stub");
  });

  it("does not require SES credentials in stub mode", () => {
    expect(() => parseEnv(valid)).not.toThrow();
  });

  // Fail closed: SES with no region or From would 500 on the first send, so the
  // app must refuse to boot instead. CREDENTIALS are deliberately absent from
  // this list — see the pairing tests below.
  it.each(["AWS_REGION", "EMAIL_FROM"])(
    "requires %s when EMAIL_MODE=ses",
    (missing) => {
      const full = {
        ...valid,
        EMAIL_MODE: "ses",
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "AKIA_EXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret-example",
        EMAIL_FROM: "Van Reservation <no-reply@example.com>",
      } as Record<string, string>;
      delete full[missing];
      expect(() => parseEnv(full as NodeJS.ProcessEnv)).toThrow(
        new RegExp(missing),
      );
    },
  );

  /**
   * Credentials are BOTH or NEITHER. Neither is a real configuration — it hands
   * authentication to the AWS SDK's default chain (named profile, SSO session,
   * instance or task role), which is what a deployment should use and what
   * spares a local SSO user re-pasting an expiring key.
   */
  it("accepts ses with NO credentials, deferring to the AWS default chain", () => {
    const env = parseEnv({
      ...valid,
      EMAIL_MODE: "ses",
      AWS_REGION: "us-east-1",
      EMAIL_FROM: "Van Reservation <no-reply@example.com>",
    });
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it.each([
    ["AWS_SECRET_ACCESS_KEY", { AWS_ACCESS_KEY_ID: "AKIA_EXAMPLE" }],
    ["AWS_ACCESS_KEY_ID", { AWS_SECRET_ACCESS_KEY: "secret-example" }],
  ])("refuses half a credential pair (%s missing)", (_missing, half) => {
    // Silent otherwise: the SDK would skip the supplied half and authenticate
    // through the default chain as somebody else entirely.
    expect(() =>
      parseEnv({
        ...valid,
        EMAIL_MODE: "ses",
        AWS_REGION: "us-east-1",
        EMAIL_FROM: "Van Reservation <no-reply@example.com>",
        ...half,
      }),
    ).toThrow(/must be set together/);
  });

  it("accepts a session token alongside a temporary key pair", () => {
    // SSO / assume-role keys start ASIA and are rejected 403 without this.
    const env = parseEnv({
      ...valid,
      EMAIL_MODE: "ses",
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "ASIA_EXAMPLE",
      AWS_SECRET_ACCESS_KEY: "secret-example",
      AWS_SESSION_TOKEN: "token-example",
      EMAIL_FROM: "Van Reservation <no-reply@example.com>",
    });
    expect(env.AWS_SESSION_TOKEN).toBe("token-example");
  });

  it("refuses a session token with no key pair to attach it to", () => {
    expect(() =>
      parseEnv({
        ...valid,
        EMAIL_MODE: "ses",
        AWS_REGION: "us-east-1",
        AWS_SESSION_TOKEN: "token-example",
        EMAIL_FROM: "Van Reservation <no-reply@example.com>",
      }),
    ).toThrow(/AWS_SESSION_TOKEN/);
  });

  it("accepts ses once region, credentials, and From are supplied", () => {
    const env = parseEnv({
      ...valid,
      EMAIL_MODE: "ses",
      AWS_REGION: "ap-southeast-1",
      AWS_ACCESS_KEY_ID: "AKIA_EXAMPLE",
      AWS_SECRET_ACCESS_KEY: "secret-example",
      EMAIL_FROM: "Van Reservation <no-reply@example.com>",
    });
    expect(env.EMAIL_MODE).toBe("ses");
    expect(env.AWS_REGION).toBe("ap-southeast-1");
    expect(env.EMAIL_FROM).toBe("Van Reservation <no-reply@example.com>");
  });

  // Absent is the safe state: the sweeper route reads this and 404s without it,
  // so an unset secret closes the endpoint rather than opening it.
  it("leaves DISPATCH_SECRET undefined when absent", () => {
    expect(parseEnv(valid).DISPATCH_SECRET).toBeUndefined();
  });

  it("rejects a dispatch secret shorter than 16 characters", () => {
    expect(() =>
      parseEnv({ ...valid, DISPATCH_SECRET: "short-secret" }),
    ).toThrow(/DISPATCH_SECRET/);
  });

  it("accepts a dispatch secret of 16 characters or more", () => {
    const env = parseEnv({ ...valid, DISPATCH_SECRET: "0123456789abcdef" });
    expect(env.DISPATCH_SECRET).toBe("0123456789abcdef");
  });
});

/**
 * The standing copy applied to every outbound message. Parsed into an array
 * here so no consumer splits a string, and so a stray comma or space cannot
 * reach SES — which rejects an entire message for one blank recipient.
 */
describe("EMAIL_ALWAYS_CC", () => {
  it("is empty when unset, so an unconfigured environment copies nobody", () => {
    expect(parseEnv(valid).EMAIL_ALWAYS_CC).toEqual([]);
  });

  it("reads a single address", () => {
    expect(
      parseEnv({ ...valid, EMAIL_ALWAYS_CC: "ops@carelon.com" })
        .EMAIL_ALWAYS_CC,
    ).toEqual(["ops@carelon.com"]);
  });

  it("splits a comma-separated list and trims each entry", () => {
    expect(
      parseEnv({
        ...valid,
        EMAIL_ALWAYS_CC:
          " one@carelon.com ,two@carelon.com,  three@carelon.com",
      }).EMAIL_ALWAYS_CC,
    ).toEqual(["one@carelon.com", "two@carelon.com", "three@carelon.com"]);
  });

  it.each(["", "   ", ",", " , , "])(
    "yields no addresses for %o rather than a blank entry",
    (raw) => {
      expect(
        parseEnv({ ...valid, EMAIL_ALWAYS_CC: raw }).EMAIL_ALWAYS_CC,
      ).toEqual([]);
    },
  );

  // A trailing comma is the likeliest hand-editing slip in a .env file, and a
  // blank recipient would fail every message it was attached to.
  it("survives a trailing comma", () => {
    expect(
      parseEnv({ ...valid, EMAIL_ALWAYS_CC: "ops@carelon.com," })
        .EMAIL_ALWAYS_CC,
    ).toEqual(["ops@carelon.com"]);
  });
});
