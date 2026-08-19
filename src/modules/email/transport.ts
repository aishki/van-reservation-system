import type { ErrorCode } from "@/lib/api-error";
import type { Result } from "@/lib/result";

/**
 * The rendered content of an email, independent of who it goes to. This is what
 * a template produces (see `templates/`); the service adds the recipient to
 * turn it into a full `EmailMessage`. Both an HTML and a plain-text body are
 * required — a text alternative keeps mail out of spam folders and readable in
 * text-only clients.
 */
export interface EmailBody {
  subject: string;
  html: string;
  text: string;
}

/**
 * One outbound message. `from` is deliberately NOT here: the application sends
 * as a single verified SES identity (`EMAIL_FROM`), so the sender is a property
 * of the transport, not of each message.
 */
export interface EmailMessage extends EmailBody {
  to: string | string[];
  /**
   * Copied recipients, visible to everyone on the message. The approval notice
   * cc's the site's Admin Support team so the requestor can see who signed off
   * and reply to all — which is the point of cc rather than a second send.
   *
   * An empty array is treated as no cc: callers build this from a database
   * query (`adminRecipients`), and a site with no notifiable admin should send
   * a valid mail to the requestor, not a message with an empty Cc header.
   */
  cc?: string[];
  replyTo?: string;
}

/** A successful send. `id` is the provider's message id (SES `MessageId`). */
export interface SentMessage {
  id: string;
}

/**
 * The failures a transport may report — a subset of `ErrorCode` via `Extract`,
 * so removing one from `ERROR_STATUS` breaks compilation here rather than
 * letting the two drift (same pattern as auth's `AuthFailure`):
 *
 * - `VALIDATION_FAILED` — the message was malformed before any send was
 *   attempted (empty recipient/subject/body). A programming error.
 * - `EMAIL_REJECTED` — the provider PERMANENTLY refused the message (bad
 *   recipient, unverified sender identity, suspended account). Do not retry
 *   unchanged.
 * - `SERVICE_UNAVAILABLE` — the provider was unreachable, timed out, or
 *   returned a 5xx. Transient; safe to retry.
 * - `RATE_LIMITED` — the provider's send-rate cap was hit. Retry with backoff.
 */
export type EmailFailure = Extract<
  ErrorCode,
  | "VALIDATION_FAILED"
  | "EMAIL_REJECTED"
  | "SERVICE_UNAVAILABLE"
  | "RATE_LIMITED"
>;

/**
 * A failure plus what the provider actually said.
 *
 * The `code` drives control flow — it is the whole of the retry decision, and
 * the four values above are deliberately few. `detail` carries the provider's
 * own exception name and message for a human reading `notification_outbox`
 * afterwards, and NOTHING branches on it.
 *
 * The split exists because collapsing them cost real debugging time: a wrong
 * AWS key surfaced only as `SERVICE_UNAVAILABLE`, indistinguishable from SES
 * being down, while the SDK had already named it `InvalidClientTokenId`. The
 * code was right and the diagnosis was unavailable.
 *
 * Never render `detail` to an end user: provider messages quote recipient
 * addresses and account identifiers.
 */
export interface EmailError {
  code: EmailFailure;
  detail?: string;
}

/** Terse constructor, so call sites read as they did when the error was a string. */
export function emailError(code: EmailFailure, detail?: string): EmailError {
  return detail === undefined ? { code } : { code, detail };
}

/**
 * The only surface the rest of the app depends on to send mail. Everything
 * upstream (the service, templates, future callers) depends on this interface
 * and never on Amazon SES directly — swapping providers means adding one class
 * beside `SesTransport`, nothing else.
 */
export interface MailTransport {
  send(message: EmailMessage): Promise<Result<SentMessage, EmailError>>;
}
