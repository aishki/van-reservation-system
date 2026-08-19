import { describe, expect, it } from "vitest";
import type { Env } from "@/lib/env";
import { selectMailTransport } from "@/modules/email/select-transport";
import { SesTransport } from "@/modules/email/ses";
import { StubTransport } from "@/modules/email/stub";

const base = { NODE_ENV: "test", EMAIL_MODE: "stub" } as unknown as Env;

const sesEnv = {
  ...base,
  EMAIL_MODE: "ses",
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "AKIA_TEST",
  AWS_SECRET_ACCESS_KEY: "secret",
  EMAIL_FROM: "Van Reservation <no-reply@example.com>",
} as unknown as Env;

describe("selectMailTransport", () => {
  it("returns the no-send stub in stub mode", () => {
    expect(selectMailTransport(base)).toBeInstanceOf(StubTransport);
  });

  it("returns the SES transport when ses is fully configured", () => {
    expect(selectMailTransport(sesEnv)).toBeInstanceOf(SesTransport);
  });

  /**
   * Absent credentials USED to return null. It no longer does, and that is the
   * point: no explicit key means "authenticate through the AWS SDK's default
   * chain" — a named profile, an SSO session, or an instance/task role — which
   * is the credential source a deployment should use. Refusing to build a
   * transport for it ruled that out.
   */
  it("builds the SES transport with no explicit credentials", () => {
    const chained = {
      ...sesEnv,
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
    } as Env;
    expect(selectMailTransport(chained)).toBeInstanceOf(SesTransport);
  });

  it("returns null when ses is selected without a region or a sender", () => {
    // These two genuinely cannot be defaulted, so the transport is unbuildable.
    for (const missing of ["AWS_REGION", "EMAIL_FROM"] as const) {
      expect(
        selectMailTransport({ ...sesEnv, [missing]: undefined } as Env),
      ).toBeNull();
    }
  });
});
