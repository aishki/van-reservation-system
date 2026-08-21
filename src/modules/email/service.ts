import { env } from "@/lib/env";
import { err, type Result } from "@/lib/result";
import {
  type BookingStatusChangeInput,
  renderBookingStatusChange,
} from "@/modules/email/templates/booking-status-change";
import {
  type EmailError,
  type EmailMessage,
  emailError,
  type MailTransport,
  type SentMessage,
} from "@/modules/email/transport";

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * The `EMAIL_ALWAYS_CC` addresses this message does not already carry.
 *
 * Deduped against `to` AND `cc`, case-insensitively. SES accepts the same
 * address in both headers and delivers it twice, and the standing CC recipient
 * is exactly the person most likely to also be one of the site's admin
 * recipients — so without this the guaranteed copy is a guaranteed duplicate.
 *
 * `seen` grows as it goes, so a list that repeats an address contributes it
 * once.
 */
function extraCc(
  to: readonly string[],
  cc: readonly string[],
  alwaysCc: readonly string[],
): string[] {
  const seen = new Set(
    [...to, ...cc].map((address) => address.trim().toLowerCase()),
  );
  const extra: string[] = [];

  for (const raw of alwaysCc) {
    const address = raw.trim();
    const key = address.toLowerCase();
    if (address === "" || seen.has(key)) continue;
    seen.add(key);
    extra.push(address);
  }

  return extra;
}

/**
 * The app-facing send entry point. Validates the message structurally — an
 * empty recipient, subject, or body is a `VALIDATION_FAILED` programming error
 * caught here rather than spent on a provider round-trip — then delegates to the
 * transport, whose failure codes propagate unchanged.
 *
 * `EMAIL_ALWAYS_CC` is applied HERE rather than at each enqueue site, because
 * this is the one function every outbound message passes through: a new
 * template, a new event, or a new caller gets the standing copy without knowing
 * it exists. `alwaysCc` is a parameter only so a test can state the list
 * instead of reaching for the process environment.
 *
 * Validation runs on the CALLER's message, before the standing copy is
 * appended. A misconfigured `EMAIL_ALWAYS_CC` must not be able to fail an
 * otherwise valid notification — and cannot, since `extraCc` drops blanks.
 */
export async function sendEmail(
  transport: MailTransport,
  message: EmailMessage,
  alwaysCc: readonly string[] = env().EMAIL_ALWAYS_CC,
): Promise<Result<SentMessage, EmailError>> {
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  const cc = message.cc ?? [];
  const valid =
    recipients.length > 0 &&
    recipients.every(hasText) &&
    // A blank cc entry is the same programming error as a blank `to` — an
    // absent admin address rendering as "" — and SES rejects the whole message
    // for it, so it is caught here rather than spent on a round-trip. An
    // ABSENT or empty cc is fine; a present-but-blank ENTRY is not.
    cc.every(hasText) &&
    hasText(message.subject) &&
    hasText(message.html) &&
    hasText(message.text);

  if (!valid) return err(emailError("VALIDATION_FAILED"));

  const extra = extraCc(recipients, cc, alwaysCc);
  if (extra.length === 0) return transport.send(message);
  return transport.send({ ...message, cc: [...cc, ...extra] });
}

/**
 * Renders a status-change notice and sends it to the requestor, copying the
 * site's Admin Support team — resolve `cc` with `adminRecipients` (see
 * `recipients.ts`), which is where "who gets this" is decided.
 *
 * Built and tested now, but not yet wired to an event: the dispatcher in
 * `../NOTIFICATIONS.md` §5 is what will call it.
 */
export async function sendBookingStatusChange(
  transport: MailTransport,
  to: string,
  input: BookingStatusChangeInput,
  cc: string[] = [],
): Promise<Result<SentMessage, EmailError>> {
  const body = await renderBookingStatusChange(input);
  // `alwaysCc` deliberately not threaded through: `sendEmail` resolves it from
  // the environment, so this wrapper cannot drop the standing copy by omission.
  return sendEmail(transport, { to, cc, ...body });
}
