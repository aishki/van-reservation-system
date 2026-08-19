import type { Env } from "@/lib/env";
import { SesTransport } from "@/modules/email/ses";
import { StubTransport } from "@/modules/email/stub";
import type { MailTransport } from "@/modules/email/transport";

/**
 * Chooses the mail transport from configuration, mirroring
 * `selectAuthProvider`. `EMAIL_MODE=ses` builds the SES transport; anything
 * else builds the no-send stub (which itself refuses to run in production).
 *
 * Returns `null` only when `ses` is selected without a region or a sender —
 * `env.ts`'s superRefine already prevents that at boot, so this is
 * defense-in-depth for a caller that constructed an `Env` some other way.
 *
 * CREDENTIALS ARE NOT REQUIRED HERE. Absent keys are a supported configuration,
 * not an incomplete one: the SES client then authenticates through the AWS
 * SDK's default credential chain — a named profile, an SSO session, or an
 * instance/task role — each of which refreshes itself, unlike a pasted key.
 * Refusing to build a transport for that case would rule out the credential
 * source a deployment should actually use.
 */
export function selectMailTransport(config: Env): MailTransport | null {
  if (config.EMAIL_MODE === "ses") {
    if (!config.AWS_REGION || !config.EMAIL_FROM) return null;
    return new SesTransport({
      region: config.AWS_REGION,
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      // Carried through for TEMPORARY keys. Dropping it here was the whole of a
      // "queued but never sent" outage: SSO credentials without their token are
      // rejected 403 by SES on every attempt.
      sessionToken: config.AWS_SESSION_TOKEN,
      from: config.EMAIL_FROM,
      replyTo: config.EMAIL_REPLY_TO,
    });
  }
  return new StubTransport(config.NODE_ENV);
}
